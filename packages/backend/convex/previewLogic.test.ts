import { describe, expect, it } from "vitest";
import {
  normalizeRemote,
  slugifyBranch,
  inferBranchPattern,
  vercelAliasCandidates,
  isProductionDeploy,
  chooseAutoWorkspace,
} from "./previewLogic";

describe("normalizeRemote", () => {
  it("unifies ssh and https forms of the same repo", () => {
    expect(normalizeRemote("git@github.com:kyle-c/commons.git")).toBe("https://github.com/kyle-c/commons");
    expect(normalizeRemote("https://github.com/kyle-c/commons.git")).toBe("https://github.com/kyle-c/commons");
    expect(normalizeRemote("https://github.com/kyle-c/commons/")).toBe("https://github.com/kyle-c/commons");
  });
  it("is case-insensitive and trims", () => {
    expect(normalizeRemote("  HTTPS://GitHub.com/Kyle-C/Commons  ")).toBe("https://github.com/kyle-c/commons");
  });
});

describe("slugifyBranch", () => {
  it("lowercases and hyphenates like Vercel/Netlify hostnames", () => {
    expect(slugifyBranch("Feature/New_Nav Bar")).toBe("feature-new-nav-bar");
  });
  it("strips leading and trailing separators", () => {
    expect(slugifyBranch("--wip--")).toBe("wip");
    expect(slugifyBranch("///")).toBe("");
  });
});

describe("inferBranchPattern", () => {
  const p = (branch: string, url: string) => ({ branch, url });

  it("refuses on a single sample — one deploy proves nothing", () => {
    expect(inferBranchPattern([p("feat-a", "https://app-git-feat-a-team.vercel.app")])).toBeNull();
  });

  it("accepts a pattern that reproduces every sample exactly", () => {
    expect(
      inferBranchPattern([
        p("feat-a", "https://app-git-feat-a-team.vercel.app"),
        p("feat-b", "https://app-git-feat-b-team.vercel.app"),
      ])
    ).toBe("https://app-git-{branch}-team.vercel.app");
  });

  it("refuses when the branch name is absent from the URLs (Vercel per-deploy ids)", () => {
    // The real bug this guards: SHA/hash URLs carry no branch, so no pattern
    // can be proven, and inventing one would mint dead links.
    expect(
      inferBranchPattern([
        p("feat-a", "https://app-kxzauj7pp-team.vercel.app"),
        p("feat-b", "https://app-krfo4j0pj-team.vercel.app"),
      ])
    ).toBeNull();
  });

  it("rejects a pattern that fits one sample but not another", () => {
    expect(
      inferBranchPattern([
        p("feat-a", "https://app-git-feat-a-team.vercel.app"),
        p("feat-b", "https://totally-different.example.com"),
      ])
    ).toBeNull();
  });

  it("dedupes repeated branches before counting", () => {
    // Two rows, same branch = one distinct sample = not enough to prove.
    expect(
      inferBranchPattern([
        p("feat-a", "https://app-git-feat-a-team.vercel.app"),
        p("feat-a", "https://app-git-feat-a-team.vercel.app"),
      ])
    ).toBeNull();
  });
});

describe("vercelAliasCandidates", () => {
  it("proposes the git-branch alias for a per-deploy URL, hash segment first", () => {
    const candidates = vercelAliasCandidates("https://v0-website-design-review-kxzauj7pp-felix-design.vercel.app");
    expect(candidates[0]).toBe("https://v0-website-design-review-git-{branch}-felix-design.vercel.app");
  });
  it("returns nothing for a non-Vercel host", () => {
    expect(vercelAliasCandidates("https://example.netlify.app")).toEqual([]);
  });
  it("returns nothing when no segment looks like a deploy id", () => {
    expect(vercelAliasCandidates("https://myapp.vercel.app")).toEqual([]);
  });
});

describe("isProductionDeploy", () => {
  it("treats an explicit production environment as production", () => {
    expect(isProductionDeploy("Production", "abc123", "main")).toBe(true);
  });
  it("treats a push to the default branch as production", () => {
    expect(isProductionDeploy(undefined, "main", "main")).toBe(true);
  });
  it("never treats preview or staging as production, even on the default branch", () => {
    expect(isProductionDeploy("Preview", "main", "main")).toBe(false);
    expect(isProductionDeploy("staging", "main", "main")).toBe(false);
  });
  it("a feature branch with no environment is not production", () => {
    expect(isProductionDeploy(undefined, "feat-x", "main")).toBe(false);
  });
});

describe("chooseAutoWorkspace", () => {
  const team = (id: string) => ({ workspaceId: id, kind: "team" as const });
  const personal = (id: string) => ({ workspaceId: id, kind: "personal" as const });

  it("prefers the single team workspace over a personal one linked alongside", () => {
    // Kyle's real shape: one installation feeding a personal playground and
    // the felixpago team. Repos deploy for the team, not the sandbox.
    expect(chooseAutoWorkspace([personal("p1"), team("t1")])).toBe("t1");
  });

  it("uses the only linked workspace even when personal", () => {
    expect(chooseAutoWorkspace([personal("p1")])).toBe("p1");
  });

  it("refuses to guess between two teams", () => {
    expect(chooseAutoWorkspace([team("t1"), team("t2")])).toBeNull();
  });

  it("refuses to guess between two personals", () => {
    expect(chooseAutoWorkspace([personal("p1"), personal("p2")])).toBeNull();
  });

  it("returns null for an unlinked installation", () => {
    expect(chooseAutoWorkspace([])).toBeNull();
  });
});
