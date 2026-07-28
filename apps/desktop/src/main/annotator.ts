import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeExecutablePath } from "./agents/sdkPath";
import type {
  AnnotationCitation,
  AnnotationDraft,
  AnnotationEvidence,
  AnnotationGenerateRequest,
  AnnotationGenerateResult,
} from "@commons/shared";

/**
 * NAR-1: the annotation pass. One agent turn against the host's working copy,
 * required to mine the project's own record (git history, docs, and the
 * Commons evidence passed in) before writing screen/flow annotations in the
 * designer's voice. The spike (commons-docs spikes/2026-07-24-nar-annotations)
 * showed history mining is load-bearing: code-only drafts miss the decisions
 * that live in commit bodies, and target repos rarely carry rationale comments.
 */

type ProgressListener = (repoPath: string, summary: string) => void;

const progressListeners = new Set<ProgressListener>();

export function onProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

function emitProgress(repoPath: string, summary: string): void {
  for (const listener of progressListeners) listener(repoPath, summary);
}

function evidenceBlock(evidence?: AnnotationEvidence): string {
  if (!evidence || (evidence.threads.length === 0 && evidence.tests.length === 0)) {
    return "No Commons discussion threads or user-test results exist for this project yet.";
  }
  const threads = evidence.threads
    .map((t) => `- thread ${t.id}${t.frameTitle ? ` (on "${t.frameTitle}")` : ""}: ${t.summary}`)
    .join("\n");
  const tests = evidence.tests.map((t) => `- test ${t.id}: ${t.summary}`).join("\n");
  return [
    "Commons project record (citable as kind \"thread\" / \"test\" with the id as ref):",
    threads,
    tests,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Past curation, as instruction.
 *
 * Shown as concrete before/after pairs rather than distilled into rules: the
 * team's edits carry their phrasing, and a rule derived from them would lose
 * exactly the thing worth copying. Rejects are included because "don't write
 * this kind of thing at all" is the strongest signal in the set.
 */
function buildVoiceSection(voice: NonNullable<AnnotationEvidence["voice"]>): string {
  if (voice.length === 0) return "";
  const edits = voice.filter((v) => v.action === "edit");
  const rejects = voice.filter((v) => v.action === "reject");
  const kept = voice.filter((v) => v.action === "approve");
  const parts: string[] = [
    "",
    "How this team edits your drafts (match this voice — it matters more than the style rules above):",
  ];
  for (const v of edits) {
    parts.push(`- You wrote: "${v.before}"`);
    parts.push(`  They rewrote it to: "${v.after}"${v.reason ? ` (tagged: ${v.reason})` : ""}`);
  }
  if (rejects.length > 0) {
    parts.push("", "They rejected these outright — do not write annotations like these:");
    for (const v of rejects) parts.push(`- "${v.before}"${v.reason ? ` (tagged: ${v.reason})` : ""}`);
  }
  if (kept.length > 0) {
    parts.push("", "They approved these untouched — this shape is working:");
    for (const v of kept) parts.push(`- "${v.before}"`);
  }
  return parts.join("\n");
}

function buildPrompt(request: AnnotationGenerateRequest): string {
  const frames = request.frames
    .map((f) => `- ${f.title}${f.routePath ? ` (route ${f.routePath})` : ""}`)
    .join("\n");
  const voiceSection = buildVoiceSection(request.evidence?.voice ?? []);
  return `You are the narration engine inside Commons, a design collaboration tool. Write the first draft of design annotations for the prototype in this repository ("${request.projectName}"), in the voice of the project's senior product designer explaining their own work to a stakeholder.

Before writing anything, mine the project's own record for design rationale:
- git log and the bodies of rationale-rich commits (read-only git commands only; never modify anything)
- README / PLAN / design docs anywhere in the repo
- the Commons record below
- the source code of the screens themselves

${evidenceBlock(request.evidence)}

Screens to annotate (match these titles exactly in your output):
${frames}

Also write 2-3 flow-level annotations for the one user flow the record suggests matters most.

Voice rules (non-negotiable):
- Outcome-first: lead with what the user gets, not what the UI contains. Active voice. No feature lists, no code walkthrough; never mention component names, hooks, or file paths in annotation text.
- Each annotation reads like the designer talking someone through the work in a review. 1-3 sentences. Concision is credibility.
- An annotation earns its place only by explaining a why: a tradeoff, an ordering, an omission, a protection, a tone choice. Never restate what is visibly true on screen.

Grounding rules (non-negotiable):
- Every annotation carries citations, or an empty citations array meaning inferred. Never invent a citation.
- Citation kinds: "commit" (ref = short hash + one-line subject), "doc" (ref = path + section), "code" (ref = path + what it shows), "thread" / "test" (ref = the Commons id above).
- When guessing at intent, prefer "the design suggests" phrasing and an empty citations array.

${voiceSection}

Write 2-4 annotations per screen. When you are done, output ONLY a fenced json block as the final thing in your reply:

\`\`\`json
{
  "annotations": [
    { "frameTitle": "Home", "text": "…", "citations": [{ "kind": "commit", "ref": "abc1234 Subject line" }] },
    { "flowTitle": "Send money", "text": "…", "citations": [] }
  ],
  "confidenceNotes": "2-3 sentences on where you were guessing most and what evidence would have helped."
}
\`\`\``;
}

function git(repoPath: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: repoPath, timeout: 10_000 }, (error, stdout) =>
      resolve(error ? null : stdout.trim())
    );
  });
}

/**
 * Mechanical citation verification (the cheap post-pass the spike recommended):
 * commit hashes must exist in this repo, doc/code paths must exist on disk,
 * thread/test ids must be ones we actually offered. Failures don't drop the
 * citation — they mark it unverified so the review queue flags it loudly.
 */
async function verifyCitations(
  repoPath: string,
  drafts: AnnotationDraft[],
  evidence?: AnnotationEvidence
): Promise<void> {
  const knownIds = new Set([
    ...(evidence?.threads.map((t) => t.id) ?? []),
    ...(evidence?.tests.map((t) => t.id) ?? []),
  ]);
  const verifyOne = async (citation: AnnotationCitation): Promise<boolean> => {
    const firstToken = citation.ref.trim().split(/[\s#:]/)[0] ?? "";
    switch (citation.kind) {
      case "commit": {
        if (!/^[0-9a-f]{6,40}$/i.test(firstToken)) return false;
        const type = await git(repoPath, ["cat-file", "-t", firstToken]);
        return type === "commit";
      }
      case "doc":
      case "code":
        return firstToken.length > 0 && fs.existsSync(path.join(repoPath, firstToken));
      case "thread":
      case "test":
        return knownIds.has(firstToken);
    }
  };
  for (const draft of drafts) {
    for (const citation of draft.citations) {
      citation.verified = await verifyOne(citation);
    }
  }
}

function parseDrafts(finalText: string): { drafts: AnnotationDraft[]; confidenceNotes?: string } | null {
  // The model is told to end with a fenced json block; take the last one.
  const fences = [...finalText.matchAll(/```json\s*([\s\S]*?)```/g)];
  const raw = fences.length > 0 ? fences[fences.length - 1][1] : finalText;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.annotations)) return null;
    const drafts: AnnotationDraft[] = [];
    for (const entry of parsed.annotations) {
      if (typeof entry?.text !== "string" || !entry.text.trim()) continue;
      const citations: AnnotationCitation[] = Array.isArray(entry.citations)
        ? entry.citations
            .filter((c: unknown): c is { kind: string; ref: string } => {
              const candidate = c as { kind?: unknown; ref?: unknown };
              return (
                typeof candidate?.kind === "string" &&
                ["commit", "doc", "code", "thread", "test"].includes(candidate.kind) &&
                typeof candidate?.ref === "string"
              );
            })
            .map((c: { kind: string; ref: string }) => ({
              kind: c.kind as AnnotationCitation["kind"],
              ref: c.ref,
            }))
        : [];
      drafts.push({
        frameTitle: typeof entry.frameTitle === "string" ? entry.frameTitle : undefined,
        flowTitle: typeof entry.flowTitle === "string" ? entry.flowTitle : undefined,
        text: entry.text.trim(),
        citations,
      });
    }
    return {
      drafts,
      confidenceNotes: typeof parsed.confidenceNotes === "string" ? parsed.confidenceNotes : undefined,
    };
  } catch {
    return null;
  }
}

/** Progress lines read like a person narrating, not a tool log. */
function humanizeToolUse(name: string, input: Record<string, unknown>): string {
  if (name === "Bash") {
    const cmd = String(input.command ?? "");
    if (/git (log|show|shortlog|cat-file|blame)/.test(cmd)) return "Reading the project's change history\u2026";
    if (/^\s*(ls|find|tree|cat)\b/.test(cmd)) return "Looking around the project\u2026";
    return "Studying the project\u2026";
  }
  const file = String(input.file_path ?? input.path ?? "");
  const base = file.split("/").pop() || "";
  if (name === "Read") {
    if (/readme|plan|design|docs?|\.md$/i.test(file)) return `Reading the docs${base ? ` (${base})` : ""}\u2026`;
    return base ? `Reading the code behind ${base}\u2026` : "Reading the code\u2026";
  }
  if (name === "Glob" || name === "Grep") return "Searching the project\u2026";
  return "Studying the project\u2026";
}

const running = new Set<string>();

export async function generate(request: AnnotationGenerateRequest): Promise<AnnotationGenerateResult> {
  if (running.has(request.repoPath)) {
    return { ok: false, drafts: [], error: "An annotation pass is already running for this repo." };
  }
  running.add(request.repoPath);
  try {
    emitProgress(request.repoPath, "Reading this project's comments, tests, and history…");
    const turn = query({
      prompt: buildPrompt(request),
      options: {
        cwd: request.repoPath,
        // Same trust envelope as agent sessions (host's own machine + key).
        // The prompt is read-only by instruction; Bash is needed for git log.
        permissionMode: "acceptEdits",
        allowedTools: ["Bash"],
        settingSources: ["user", "project"],
        maxTurns: 40,
        pathToClaudeCodeExecutable: claudeExecutablePath(),
      },
    });
    let finalText = "";
    let costUsd: number | undefined;
    for await (const message of turn) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            const input = (block.input ?? {}) as Record<string, unknown>;
            emitProgress(request.repoPath, humanizeToolUse(block.name, input));
          }
        }
      }
      if (message.type === "result") {
        costUsd = message.total_cost_usd;
        if (message.subtype === "success" && "result" in message && message.result) {
          finalText = message.result;
        } else {
          return { ok: false, drafts: [], costUsd, error: `Annotator stopped: ${message.subtype}` };
        }
      }
    }
    const parsed = parseDrafts(finalText);
    if (!parsed || parsed.drafts.length === 0) {
      return { ok: false, drafts: [], costUsd, error: "The annotator produced no parseable annotations." };
    }
    emitProgress(request.repoPath, "Double-checking every citation against the repo…");
    await verifyCitations(request.repoPath, parsed.drafts, request.evidence);
    return { ok: true, drafts: parsed.drafts, confidenceNotes: parsed.confidenceNotes, costUsd };
  } catch (error) {
    return {
      ok: false,
      drafts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    running.delete(request.repoPath);
  }
}
