/**
 * Pure preview/branch logic — no Convex, no db, no fetch, no imports.
 *
 * Extracted from github.ts so it can be unit-tested in isolation (see
 * previewLogic.test.ts) and reused without dragging in the Convex runtime.
 * Everything here is a deterministic string function; that is the whole point.
 */

/** Compare git remotes across ssh/https, .git suffixes, and case. */
export function normalizeRemote(remote: string): string {
  return remote
    .trim()
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * How hosts render a branch name inside a hostname. Vercel and Netlify both
 * lowercase and replace anything outside [a-z0-9] with a hyphen.
 */
export function slugifyBranch(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface DeploySample {
  branch: string;
  url: string;
}

/**
 * Infer a "{branch}"-templated preview URL from observed deploys.
 *
 * The pattern is accepted only when filling it with each sample's own branch
 * reproduces that sample's URL exactly, for every sample we hold. One
 * disagreeing observation is enough to reject, which is what keeps a wrong
 * pattern from ever reaching a project. Returns null when unprovable.
 */
export function inferBranchPattern(samples: DeploySample[]): string | null {
  const distinct = new Map<string, DeploySample>();
  for (const s of samples) {
    if (!s.branch || !s.url) continue;
    if (!distinct.has(s.branch)) distinct.set(s.branch, s);
  }
  const unique = [...distinct.values()];
  if (unique.length < 2) return null; // one deploy proves nothing

  // Anchor on the first sample: wherever its slug appears is a candidate
  // split. Multiple occurrences means multiple candidates, so try each.
  const anchor = unique[0];
  const anchorSlug = slugifyBranch(anchor.branch);
  if (!anchorSlug) return null;

  for (let from = 0; ; ) {
    const at = anchor.url.indexOf(anchorSlug, from);
    if (at === -1) break;
    from = at + 1;
    const prefix = anchor.url.slice(0, at);
    const suffix = anchor.url.slice(at + anchorSlug.length);
    const candidate = `${prefix}{branch}${suffix}`;
    const holds = unique.every(
      (s) => candidate.replace("{branch}", slugifyBranch(s.branch)) === s.url
    );
    if (holds) return candidate;
  }
  return null;
}

/**
 * Candidate branch-alias patterns for a Vercel per-deployment URL.
 *
 * Vercel reports "project-kxzauj7pp-team.vercel.app": a random deploy id, no
 * branch name anywhere, so evidence-based inference correctly refuses. But
 * Vercel also publishes "project-git-{branch}-team.vercel.app" for every
 * branch; it just never tells us about it.
 *
 * This proposes that shape as a hypothesis, nothing more. Every segment that
 * could be the deploy id yields one candidate, ambiguity included, because
 * the caller must verify a candidate resolves against a real branch before
 * anything is stored. Host knowledge here only ever generates guesses to be
 * checked; it is never trusted on its own.
 */
export function vercelAliasCandidates(sampleUrl: string): string[] {
  const match = sampleUrl.match(/^https:\/\/([a-z0-9-]+)\.vercel\.app$/);
  if (!match) return [];
  const parts = match[1].split("-");
  const candidates: { pattern: string; hashLike: boolean }[] = [];
  for (let i = 1; i < parts.length - 1; i += 1) {
    const segment = parts[i];
    // Deploy ids are short alphanumeric blobs; anything else is part of the
    // project or team name. Wrong picks die at verification, not here.
    if (!/^[a-z0-9]{7,12}$/.test(segment)) continue;
    candidates.push({
      pattern: `https://${parts.slice(0, i).join("-")}-git-{branch}-${parts.slice(i + 1).join("-")}.vercel.app`,
      hashLike: /\d/.test(segment),
    });
  }
  // Segments containing digits are far more likely to be the deploy id, so
  // try those first and waste fewer verification fetches.
  candidates.sort((a, b) => Number(b.hashLike) - Number(a.hashLike));
  return candidates.slice(0, 4).map((c) => c.pattern);
}

/** A deploy that represents the live product, not a branch preview. */
export function isProductionDeploy(environment: string | undefined, ref: string, defaultBranch: string): boolean {
  const env = (environment ?? "").toLowerCase();
  if (env.includes("preview") || env.includes("staging")) return false;
  return env.includes("production") || ref === defaultBranch;
}


/**
 * Which workspace should a project born from a deploy land in?
 *
 * An installation can feed several workspaces, and creating the project in
 * all of them is spam while picking one at random is invention. The rule,
 * in order, deterministic and explainable in a sentence:
 *
 * 1. Exactly one linked team workspace → that one. Teams are where shared
 *    repos live; a personal playground linked alongside is someone's sandbox.
 * 2. Otherwise, exactly one linked workspace of any kind → that one.
 * 3. Otherwise null: genuinely ambiguous, so no project is created and the
 *    deploy is recorded as dropped-for-ambiguity rather than guessed at.
 */
export function chooseAutoWorkspace(
  linked: { workspaceId: string; kind: "team" | "personal" }[]
): string | null {
  const teams = linked.filter((l) => l.kind === "team");
  if (teams.length === 1) return teams[0].workspaceId;
  if (linked.length === 1) return linked[0].workspaceId;
  return null;
}
