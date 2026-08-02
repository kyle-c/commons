import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * The two scripts that execute in other people's CI.
 *
 * `RUNNER_SCRIPT` and `FLOW_CRAWLER` are served over HTTP and `curl`ed fresh
 * into every connected repo's Actions run, then executed with `contents:
 * write`. That indirection is deliberate — fixes ship without a commit in
 * anyone's repo — but it also means a bad push to either string is live in
 * every connected repo on the next run, with no build, no review, and no
 * deploy of theirs in between. ARCHITECTURE §7 calls this out as the sharpest
 * open risk, and it grew teeth as the connected-repo count grew.
 *
 * TypeScript cannot help here: both scripts are template literals, so to the
 * compiler they are strings. A stray backtick or `${` inside one is a silent
 * corruption, and that has already happened once — a comment containing a
 * backticked word terminated `RUNNER_SCRIPT` early and only surfaced as a
 * confusing type error somewhere else in the file.
 *
 * Read as source text rather than imported. Importing would pull the whole
 * Convex module graph into a Node-typed test program, where fetch and the
 * globals resolve differently than they do in the Convex runtime, so the
 * backend would be typechecked against the wrong lib and report errors that
 * are not real. Text also tests the thing actually served: because these
 * literals interpolate nothing (asserted below), the bytes here are the bytes
 * a customer's CI downloads.
 */

const convexDir = join(__dirname, "..", "convex");

/** The body of an exported template literal, exactly as written in the source. */
function rawLiteral(file: string, name: string): string {
  const source = readFileSync(join(convexDir, file), "utf8");
  const marker = `export const ${name} = \``;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${name} not found in ${file}`);
  const from = start + marker.length;
  const end = source.indexOf("\n`;", from);
  if (end === -1) throw new Error(`${name} in ${file} has no closing backtick`);
  return source.slice(from, end);
}

/**
 * The bytes a customer's CI actually downloads.
 *
 * Source text alone is not that, which this file learned the hard way: the
 * crawler contains `/\\/+$/` in source, because a template literal turns `\\`
 * into one backslash, and the served regex is `/\/+$/`. Syntax-checking the
 * raw text therefore failed on a script that is perfectly valid in flight.
 *
 * So the literal is evaluated to resolve its escapes. That is only safe
 * because nothing is interpolated — asserted separately against the raw text,
 * and the assertion has to stay for this to remain a read rather than an
 * execution of whatever someone put in a `${...}`.
 */
const REAL_INTERPOLATION = /(?<!\\)\$\{/;

function served(file: string, name: string): string {
  const raw = rawLiteral(file, name);
  // An escaped `\${` is a literal dollar-brace in the output, not a
  // substitution — WORKFLOW_FILE is full of them, because GitHub Actions
  // expressions are written `\${{ secrets.X }}` so TypeScript leaves them
  // alone. Only an unescaped `${` actually runs code at build time.
  if (REAL_INTERPOLATION.test(raw)) throw new Error(`${name} interpolates; refusing to evaluate it`);
  return new Function(`return \`${raw}\`;`)() as string;
}

const SCRIPTS = [
  { name: "RUNNER_SCRIPT", file: "cloudAgents.ts", filename: "runner.mjs" },
  { name: "FLOW_CRAWLER", file: "flows.ts", filename: "flow-crawler.mjs" },
] as const;

/** Syntax-check exactly as Node will: ESM, no execution. */
function parsesAsModule(source: string, name: string): { ok: boolean; error?: string } {
  const dir = mkdtempSync(join(tmpdir(), "commons-runner-"));
  const file = join(dir, name);
  writeFileSync(file, source);
  try {
    // --check parses and reports syntax errors without running a line.
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return { ok: true };
  } catch (error) {
    const err = error as { stderr?: Buffer };
    return { ok: false, error: err.stderr?.toString() ?? String(error) };
  }
}

describe("scripts that run in customer CI", () => {
  it.each(SCRIPTS)("$name parses as an ES module", ({ file, name, filename }) => {
    const result = parsesAsModule(served(file, name), filename);
    expect(result.ok, result.error).toBe(true);
  });

  it.each(SCRIPTS)("$name interpolates nothing at build time", ({ file, name }) => {
    // An interpolated value would be resolved on the Commons deployment and
    // baked into the script every customer's CI downloads, which is how a
    // per-request value silently becomes a shared constant. It would also
    // break the equivalence this file relies on: that the source text is
    // what gets served.
    expect(rawLiteral(file, name), `${name} interpolates a build-time value`).not.toMatch(
      REAL_INTERPOLATION
    );
  });

  it.each(SCRIPTS)("$name is not truncated", ({ file, name }) => {
    // A backtick inside the literal closes it early, leaving a script that
    // still parses but stops halfway. Every one of these reports back to
    // Commons; a truncated copy silently never does.
    const body = served(file, name);
    expect(body.length, `${name} is suspiciously short`).toBeGreaterThan(1000);
    expect(body, `${name} does not report back to Commons`).toMatch(/callback|COMMONS_/);
  });

  it("the runner and the workflow agree on the contract", () => {
    // Three names have to match across code that is edited apart. Each
    // mismatch fails the same way — a run that starts and does nothing —
    // which is expensive to debug through someone else's Actions log.
    const workflow = served("cloudAgents.ts", "WORKFLOW_FILE");
    const runner = served("cloudAgents.ts", "RUNNER_SCRIPT");
    expect(workflow).toMatch(/types:\s*\[commons-agent\]/);
    expect(workflow).toMatch(/ANTHROPIC_API_KEY:\s*\$\{\{\s*secrets\.ANTHROPIC_API_KEY\s*\}\}/);
    expect(workflow).toMatch(/COMMONS_PAYLOAD:\s*\$\{\{\s*toJson\(github\.event\.client_payload\)\s*\}\}/);
    expect(runner).toMatch(/process\.env\.COMMONS_PAYLOAD/);
  });

  it("the workflow asks for write access, because the runner pushes", () => {
    expect(served("cloudAgents.ts", "WORKFLOW_FILE")).toMatch(/permissions:\s*\n\s*contents:\s*write/);
  });

  it("the workflow fetches the runner from the dispatching Commons, not a baked-in host", () => {
    // The callback travels in the payload so a deployment always serves its
    // own runner. A hardcoded hostname here would point every customer repo
    // at whichever deployment happened to be in the string.
    const workflow = served("cloudAgents.ts", "WORKFLOW_FILE");
    expect(workflow).toMatch(/setup\/agent-runner\.mjs/);
    expect(workflow).toMatch(/CALLBACK/);
    expect(workflow).not.toMatch(/https:\/\/[a-z-]+\.convex\.site/);
  });

  it("drafts land on a commons/ branch and nothing else", () => {
    // The whole safety story for `contents: write` is that pushes are
    // confined to a namespace nobody works in.
    const runner = served("cloudAgents.ts", "RUNNER_SCRIPT");
    expect(runner).toMatch(/commons\//);
    expect(runner).not.toMatch(/push[^\n]*\bmain\b/);
  });
});
