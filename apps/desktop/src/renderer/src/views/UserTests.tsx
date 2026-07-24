import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import { getConvexUrl, timeAgo, sessionToken } from "../lib/session";

/**
 * Maze-style usability testing, built on what Commons already has: tests run
 * against the project's deployed preview, the tester page is served by the
 * Convex deployment itself (/t/<token> on the .convex.site domain), and click
 * heatmaps land back on the canvas frames.
 */

/** The deployment's HTTP-actions origin, where tester/report pages live. */
function siteUrl(): string | null {
  const url = getConvexUrl();
  return url ? url.replace(".convex.cloud", ".convex.site") : null;
}

const DEVICES = [
  { label: "Phone", width: 390, height: 844 },
  { label: "Tablet", width: 834, height: 1194 },
  { label: "Desktop", width: 0, height: 0 },
] as const;

interface TaskDraft {
  instruction: string;
  targetRoute: string;
}
interface QuestionDraft {
  prompt: string;
  kind: "scale" | "text";
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn ghost"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function NewTestForm({
  project,
  me,
  routes,
  mobileDefault,
  onDone,
}: {
  project: Doc<"projects">;
  me: Doc<"users">;
  routes: Doc<"frames">[];
  mobileDefault: boolean;
  onDone: () => void;
}) {
  const create = useMutation(api.userTests.create);
  const [title, setTitle] = useState("");
  const [startRoute, setStartRoute] = useState(routes[0]?.routePath ?? "/");
  const [device, setDevice] = useState<(typeof DEVICES)[number]>(mobileDefault ? DEVICES[0] : DEVICES[2]);
  const [tasks, setTasks] = useState<TaskDraft[]>([{ instruction: "", targetRoute: "" }]);
  const [questions, setQuestions] = useState<QuestionDraft[]>([
    { prompt: "How easy was that, overall? (1 = very hard, 5 = very easy)", kind: "scale" },
  ]);
  const [variantLabel, setVariantLabel] = useState("");
  const [variantUrl, setVariantUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const variantOn = variantUrl.trim() !== "";
  const variantValid = !variantOn || /^https?:\/\/.+/.test(variantUrl.trim());
  const valid = title.trim() !== "" && tasks.some((t) => t.instruction.trim() !== "") && variantValid;

  const submit = async () => {
    setSaving(true);
    try {
      await create({
        projectId: project._id,
        userId: me._id,
        title: title.trim(),
        startRoute,
        device: { width: device.width, height: device.height },
        tasks: tasks
          .filter((t) => t.instruction.trim() !== "")
          .map((t, i) => ({
            id: `t${i + 1}`,
            instruction: t.instruction.trim(),
            targetRoute: t.targetRoute || undefined,
          })),
        questions: questions
          .filter((q) => q.prompt.trim() !== "")
          .map((q, i) => ({ id: `q${i + 1}`, prompt: q.prompt.trim(), kind: q.kind })),
        variant: variantOn
          ? { label: variantLabel.trim() || "variant B", url: variantUrl.trim().replace(/\/+$/, "") }
          : undefined,
      });
      onDone();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="test-form">
      <input
        autoFocus
        placeholder="Test name — e.g. “Can people find checkout?”"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="test-form-row">
        <label>Starts on</label>
        <select value={startRoute} onChange={(e) => setStartRoute(e.target.value)}>
          {routes.map((f) => (
            <option key={f._id} value={f.routePath ?? "/"}>
              {f.title} — {f.routePath}
            </option>
          ))}
        </select>
        <div className="seg">
          {DEVICES.map((d) => (
            <button key={d.label} className={device.label === d.label ? "on" : ""} onClick={() => setDevice(d)}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <strong>Tasks</strong>
      {tasks.map((task, i) => (
        <div className="test-form-row" key={i}>
          <input
            style={{ flex: 1 }}
            placeholder={`Task ${i + 1} — e.g. “Buy the cheapest plan”`}
            value={task.instruction}
            onChange={(e) => setTasks(tasks.map((t, j) => (j === i ? { ...t, instruction: e.target.value } : t)))}
          />
          <select
            title="Reaching this screen auto-completes the task; leave unset for self-reported tasks"
            value={task.targetRoute}
            onChange={(e) => setTasks(tasks.map((t, j) => (j === i ? { ...t, targetRoute: e.target.value } : t)))}
          >
            <option value="">success: tester says so</option>
            {routes.map((f) => (
              <option key={f._id} value={f.routePath ?? "/"}>
                success: reaches {f.routePath}
              </option>
            ))}
          </select>
          <button className="btn ghost" title="Remove task" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button className="btn ghost" onClick={() => setTasks([...tasks, { instruction: "", targetRoute: "" }])}>
        + Task
      </button>

      <strong>Follow-up questions</strong>
      {questions.map((q, i) => (
        <div className="test-form-row" key={i}>
          <input
            style={{ flex: 1 }}
            placeholder="Question prompt"
            value={q.prompt}
            onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))}
          />
          <select
            value={q.kind}
            onChange={(e) =>
              setQuestions(questions.map((x, j) => (j === i ? { ...x, kind: e.target.value as "scale" | "text" } : x)))
            }
          >
            <option value="scale">1–5 scale</option>
            <option value="text">free text</option>
          </select>
          <button className="btn ghost" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button className="btn ghost" onClick={() => setQuestions([...questions, { prompt: "", kind: "scale" }])}>
        + Question
      </button>

      <strong title="Testers alternate between the current preview (A) and this URL (B) — paste an agent draft's branch preview to A/B a change before merging">
        Variant B <span className="hint">(optional — A/B against a draft preview)</span>
      </strong>
      <div className="test-form-row">
        <input
          style={{ width: 130 }}
          placeholder="Label, e.g. “new nav”"
          value={variantLabel}
          onChange={(e) => setVariantLabel(e.target.value)}
        />
        <input
          style={{ flex: 1 }}
          placeholder="https://myapp-git-commons-new-nav-team.vercel.app"
          value={variantUrl}
          onChange={(e) => setVariantUrl(e.target.value)}
        />
      </div>

      <div className="test-form-row" style={{ justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" disabled={!valid || saving} onClick={submit}>
          {saving ? "Creating…" : "Create & get link"}
        </button>
      </div>
    </div>
  );
}

function fmtSecs(ms: number): string {
  return ms >= 60000 ? `${Math.round(ms / 6000) / 10} min` : `${Math.round(ms / 100) / 10}s`;
}

/** #5: a failing test task, packaged as a self-contained agent prompt. */
function buildTaskFixPrompt(
  test: Doc<"tests">,
  task: Doc<"tests">["tasks"][number],
  results: Doc<"testSessions">["tasks"],
  topPaths: [string, number][]
): string {
  const successes = results.filter((r) => r.outcome === "success");
  const gaveUp = results.filter((r) => r.outcome === "gave_up");
  const clicksTotal = results.reduce((a, r) => a + r.clickCount, 0);
  const misclicksTotal = results.reduce((a, r) => a + r.misclickCount, 0);
  const avgMs = successes.length ? successes.reduce((a, r) => a + r.durationMs, 0) / successes.length : 0;
  return [
    `You are addressing a usability problem found by real user testing on this repo.`,
    ``,
    `Testers were asked: "${task.instruction}"`,
    task.targetRoute ? `Success meant reaching the route "${task.targetRoute}".` : ``,
    `The test started on route "${test.startRoute}" at ${test.device.width > 0 ? `${test.device.width}px (mobile/tablet) width` : `desktop width`}.`,
    ``,
    `Results across ${results.length} testers:`,
    `- ${successes.length} succeeded (${Math.round((successes.length / Math.max(1, results.length)) * 100)}%), ${gaveUp.length} gave up`,
    successes.length ? `- average time for those who succeeded: ${fmtSecs(avgMs)}` : ``,
    clicksTotal
      ? `- ${misclicksTotal} of ${clicksTotal} clicks (${Math.round((misclicksTotal / clicksTotal) * 100)}%) hit nothing interactive — testers clicked where they expected something clickable`
      : ``,
    topPaths.length ? `` : ``,
    topPaths.length ? `Actual navigation paths taken (most common first):` : ``,
    ...topPaths.map(([path, count]) => `- ${count}×: ${path}`),
    ``,
    `Diagnose why testers struggled with this task and make the code changes that would fix it — usually clearer affordances, labels, or navigation on the routes above. Keep changes minimal and consistent with the codebase conventions. When you're done, summarize what you changed and why it should improve the task's success rate.`,
  ]
    // collapse the gaps left by omitted optional lines
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

function TestResults({
  test,
  me,
  onShowHeatmap,
  onSendToAgent,
  onClose,
}: {
  test: Doc<"tests">;
  me: Doc<"users">;
  onShowHeatmap?: (testId: Id<"tests">) => void;
  onSendToAgent?: (title: string, prompt: string, routePath?: string) => void;
  onClose: () => void;
}) {
  const data = useQuery(api.userTests.results, { testId: test._id, userId: me._id, sessionToken: sessionToken() });
  const site = siteUrl();
  const sessions = data?.sessions ?? [];
  const completed = sessions.filter((s) => s.completedAt);
  const anyInstrumented = sessions.some((s) => s.instrumented);

  return (
    <div className="test-results" onMouseDown={(e) => e.stopPropagation()}>
      <div className="test-results-head">
        <strong>{test.title}</strong>
        <span className="hint">
          {sessions.length} started · {completed.length} completed
        </span>
        <span style={{ flex: 1 }} />
        {site && <CopyButton text={`${site}/r/${test.reportToken}`} label="Copy report link" />}
        {onShowHeatmap && (
          <button className="btn ghost" onClick={() => onShowHeatmap(test._id)}>
            Clicks on canvas
          </button>
        )}
        <button className="btn ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      {sessions.length === 0 && <div className="hint">No sessions yet — share the test link.</div>}
      {sessions.length > 0 && !anyInstrumented && (
        <div className="hint">
          Sessions are self-reported only. Add the snippet to the app for routes, clicks and heatmaps:{" "}
          {site && <code>{`<script src="${site}/commons-testing.js"></script>`}</code>}
        </div>
      )}

      {test.tasks.map((task, i) => {
        // Variant tests (UT-11) show one stat line per arm, A/B side by side.
        const arms: { label: string | null; sessions: typeof sessions }[] = test.variant
          ? [
              { label: "A · current", sessions: sessions.filter((s) => (s.variant ?? "a") === "a") },
              { label: `B · ${test.variant.label}`, sessions: sessions.filter((s) => s.variant === "b") },
            ]
          : [{ label: null, sessions }];
        const allResults = sessions.flatMap((s) => s.tasks.filter((t) => t.taskId === task.id));
        // Top actual paths, most common first — the "expected vs actual" view.
        const pathCounts = new Map<string, number>();
        for (const r of allResults) {
          if (r.routeSequence.length === 0) continue;
          const key = r.routeSequence.join(" → ");
          pathCounts.set(key, (pathCounts.get(key) ?? 0) + 1);
        }
        const topPaths = [...pathCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        return (
          <div className="test-task-stats" key={task.id}>
            <div className="test-task-title">
              {i + 1}. {task.instruction}
              {task.targetRoute && <span className="hint"> → expects {task.targetRoute}</span>}
              {onSendToAgent && allResults.length > 0 && (
                <button
                  className="btn ghost"
                  style={{ marginLeft: "auto" }}
                  title="Draft a fix from these results — the agent gets the task, success rates, paths, and misclick data"
                  onClick={() =>
                    onSendToAgent(
                      `Test fix: ${task.instruction.slice(0, 46)}`,
                      buildTaskFixPrompt(test, task, allResults, topPaths),
                      test.startRoute
                    )
                  }
                >
                  ⚡ Send to agent
                </button>
              )}
            </div>
            {arms.map((arm) => {
              const results = arm.sessions.flatMap((s) => s.tasks.filter((t) => t.taskId === task.id));
              const successes = results.filter((r) => r.outcome === "success");
              const avgMs = successes.length
                ? successes.reduce((a, r) => a + r.durationMs, 0) / successes.length
                : 0;
              const clicksTotal = results.reduce((a, r) => a + r.clickCount, 0);
              const misclicksTotal = results.reduce((a, r) => a + r.misclickCount, 0);
              return (
                <div className="test-task-nums" key={arm.label ?? "all"}>
                  {arm.label && <span className="variant-tag">{arm.label}</span>}
                  <span>
                    <strong>
                      {results.length ? `${Math.round((successes.length / results.length) * 100)}%` : "—"}
                    </strong>{" "}
                    success ({results.length} attempts)
                  </span>
                  <span>
                    <strong>{successes.length ? fmtSecs(avgMs) : "—"}</strong> avg time
                  </span>
                  <span>
                    <strong>{clicksTotal ? `${Math.round((misclicksTotal / clicksTotal) * 100)}%` : "—"}</strong>{" "}
                    misclicks
                  </span>
                </div>
              );
            })}
            {topPaths.length > 0 && (
              <div className="test-paths">
                {topPaths.map(([path, count]) => (
                  <div key={path} className="hint">
                    ×{count} {path}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {test.questions.length > 0 && completed.length > 0 && (
        <div className="test-task-stats">
          <div className="test-task-title">Questions</div>
          {test.questions.map((q) => {
            const values = completed.flatMap((s) => (s.answers ?? []).filter((a) => a.questionId === q.id && a.value));
            if (q.kind === "scale") {
              const nums = values.map((a) => Number(a.value)).filter((n) => n >= 1 && n <= 5);
              const avg = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
              return (
                <div key={q.id} className="hint">
                  {q.prompt} — <strong>{avg === null ? "no responses" : `${avg} / 5`}</strong>
                  {nums.length > 0 && ` (${nums.length})`}
                </div>
              );
            }
            return (
              <div key={q.id} className="hint">
                {q.prompt}
                {values.length === 0 ? (
                  <> — no responses</>
                ) : (
                  <ul>
                    {values.map((a, i) => (
                      <li key={i}>{a.value}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {sessions.length > 0 && (
        <table className="test-sessions">
          <thead>
            <tr>
              <th>Session</th>
              <th>Tasks</th>
              <th>Instrumented</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s._id}>
                <td>{timeAgo(s.startedAt)} ago</td>
                <td>
                  {s.tasks
                    .map((t) => (t.outcome === "success" ? (t.auto ? "✓" : "✓*") : "✗"))
                    .join(" ") || "—"}
                </td>
                <td>{s.instrumented ? "yes" : "no"}</td>
                <td>{s.completedAt ? "completed" : "abandoned"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="hint">✓ auto-detected · ✓* self-reported · ✗ gave up</div>
    </div>
  );
}

export default function UserTests({
  project,
  me,
  frames,
  onShowHeatmap,
  onSendToAgent,
  onClose,
}: {
  project: Doc<"projects">;
  me: Doc<"users">;
  frames: Doc<"frames">[];
  onShowHeatmap?: (testId: Id<"tests">) => void;
  onSendToAgent?: (title: string, prompt: string, routePath?: string) => void;
  onClose: () => void;
}) {
  const tests = useQuery(api.userTests.forProject, { projectId: project._id, userId: me._id, sessionToken: sessionToken() });
  const setStatus = useMutation(api.userTests.setStatus);
  const [creating, setCreating] = useState(false);
  const [resultsFor, setResultsFor] = useState<Id<"tests"> | null>(null);
  const site = siteUrl();
  const routes = useMemo(() => frames.filter((f) => f.kind === "route"), [frames]);
  const mobileDefault = routes.length > 0 && routes.every((f) => f.width <= 500);
  const openResults = tests?.find((t) => t._id === resultsFor);

  return (
    <div className="user-tests" onMouseDown={(e) => e.stopPropagation()}>
      <div className="user-tests-head">
        <strong>User tests</strong>
        <span style={{ flex: 1 }} />
        <button
          className="btn primary"
          onClick={() => setCreating(true)}
          disabled={!project.previewUrl}
          title={
            project.previewUrl
              ? undefined
              : "Needs a deployed preview first — set it via “Preview URL” in the titlebar"
          }
        >
          + New test
        </button>
        <button className="btn ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      {!project.previewUrl && (
        <div className="hint">
          Tests run on the <strong>deployed</strong> app so testers don't need Commons or the repo — this project
          doesn't have one linked yet. Deploy it (e.g. Vercel), then paste the URL via{" "}
          <strong>“Preview URL”</strong> in the titlebar and this button unlocks.
        </div>
      )}

      {creating && (
        <NewTestForm
          project={project}
          me={me}
          routes={routes}
          mobileDefault={mobileDefault}
          onDone={() => setCreating(false)}
        />
      )}

      {tests === undefined && <div className="hint">Loading tests…</div>}

      {(tests ?? []).map((test) => (
        <div className="user-test-row" key={test._id}>
          <div className="user-test-main">
            <strong>{test.title}</strong>
            <span className="hint">
              {test.tasks.length} task{test.tasks.length === 1 ? "" : "s"} · {test.sessionCount} session
              {test.sessionCount === 1 ? "" : "s"} ({test.completedCount} completed) ·{" "}
              {timeAgo(test._creationTime)} ago
            </span>
          </div>
          <span className={`badge ${test.status === "live" ? "live" : ""}`}>{test.status}</span>
          {site && test.status === "live" && <CopyButton text={`${site}/t/${test.token}`} label="Copy test link" />}
          <button className="btn ghost" onClick={() => setResultsFor(resultsFor === test._id ? null : test._id)}>
            Results
          </button>
          <button
            className="btn ghost"
            title={test.status === "live" ? "Stop accepting responses" : "Reopen the test"}
            onClick={() => void setStatus({ testId: test._id, userId: me._id, status: test.status === "live" ? "closed" : "live" })}
          >
            {test.status === "live" ? "Close" : "Reopen"}
          </button>
        </div>
      ))}

      {tests && tests.length === 0 && !creating && (
        <div className="hint">
          Send a task-based test to anyone with a link — success rates, times, paths and click heatmaps come back
          here. Testers don't need Commons.
        </div>
      )}

      {openResults && (
        <TestResults
          test={openResults}
          me={me}
          onShowHeatmap={onShowHeatmap}
          onSendToAgent={onSendToAgent}
          onClose={() => setResultsFor(null)}
        />
      )}
    </div>
  );
}
