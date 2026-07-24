import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import type { AgentSessionEvent, AgentSessionInfo, DevServerStatus, GitRepoStatus } from "@commons/shared";
import { buildDeepLink } from "@commons/shared";
import type { Nav } from "../App";
import type { ThreadWithMessages } from "../comments/types";
import CanvasView from "../canvas/CanvasView";
import PrototypeView from "./PrototypeView";
import Inbox from "./Inbox";
import AgentPanel, { type PanelSession } from "../agents/AgentPanel";
import ThemeToggle from "./ThemeToggle";
import { useAgentSessions, type AgentResultEvent } from "../agents/useAgentSessions";
import { getConvexUrl, initials, sessionToken } from "../lib/session";
import { resolveFrameUrl } from "../lib/frameUrl";
import { registerShortcut } from "../lib/shortcuts";
import { layoutFrames } from "../lib/frameLayout";
import { useClickOutside } from "../lib/useClickOutside";
import { useMachineId } from "../lib/machine";

/** "Fix savings header" → "fix-savings-header" (draft branch slugs). */
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/, "") || "draft"
  );
}

/** Turn a comment thread + its frame into a self-contained prompt for the coding agent. */
function buildThreadPrompt(thread: ThreadWithMessages, frame: Doc<"frames"> | undefined): string {
  const where = frame
    ? `The thread is pinned to the live preview of the "${frame.title}" frame, which renders the route "${frame.routePath ?? "/"}"` +
      (thread.fx !== undefined && thread.fy !== undefined
        ? `, at roughly ${Math.round(thread.fx * 100)}% from the left and ${Math.round(thread.fy * 100)}% from the top of the page.`
        : ".")
    : "The thread is pinned to the project canvas rather than a specific screen.";
  return [
    `You are addressing design feedback on this repo. ${where}`,
    "",
    "Feedback thread:",
    ...thread.messages.map((m) => `- ${m.author?.name ?? "Teammate"}: ${m.body}`),
    "",
    "Make the code changes needed to address the feedback. Keep changes minimal and consistent with the codebase conventions. When you're done, summarize what you changed in one or two sentences.",
  ].join("\n");
}

/** Titlebar popover for the project's deployed preview base URL. */
function PreviewSettings({
  project,
  open,
  onOpenChange,
}: {
  project: Doc<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
  const [value, setValue] = useState("");
  const [pattern, setPattern] = useState("");
  const setPreviewUrl = useMutation(api.projects.setPreviewUrl);
  const trimmed = value.trim();
  const trimmedPattern = pattern.trim();
  const valid = trimmed === "" || /^https?:\/\/.+/.test(trimmed);
  const patternValid = trimmedPattern === "" || (/^https?:\/\/.+/.test(trimmedPattern) && trimmedPattern.includes("{branch}"));
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className={`btn ghost ${open ? "active" : ""}`}
        title="Where teammates without the repo see this project — frames fall back to this deployed URL when no local dev server is running"
        onClick={() => {
          setValue(project.previewUrl ?? "");
          setPattern(project.branchPreviewPattern ?? "");
          setOpen(!open);
        }}
      >
        Preview URL{project.previewUrl ? "" : " ⚠"}
      </button>
      {open && (
        <div className="titlebar-popover popover-form">
          <div className="form-field">
            <label>Preview URL</label>
            <span className="hint">
              The deployed app — teammates without the repo see live frames from here, and it's what user tests
              run against.
            </span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://myapp.vercel.app"
              autoFocus
            />
            {!valid && <span className="form-error">Needs to be a full https:// URL</span>}
          </div>
          <div className="form-field">
            <label>
              Branch preview pattern <span className="hint">optional</span>
            </label>
            <span className="hint">
              Unlocks draft previews and A/B tests. Write {"{branch}"} where the branch slug goes — on Vercel
              that's <code>myapp-git-{"{branch}"}-team</code>.
            </span>
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={"https://myapp-git-{branch}-team.vercel.app"}
            />
            {!patternValid && <span className="form-error">Needs https:// and a {"{branch}"} placeholder</span>}
          </div>
          <div className="form-actions">
            <button className="btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={!valid || !patternValid}
              onClick={async () => {
                await setPreviewUrl({
                  projectId: project._id,
                  previewUrl: trimmed === "" ? undefined : trimmed.replace(/\/+$/, ""),
                  branchPreviewPattern: trimmedPattern === "" ? undefined : trimmedPattern.replace(/\/+$/, ""),
                  hasBranchPattern: true,
                });
                setOpen(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Side-by-side current-vs-draft compare (PRJ-14): two live iframes at the same route. */
function CompareDraft({
  title,
  mainUrl,
  draftUrl,
  onClose,
}: {
  title: string;
  mainUrl: string | null;
  draftUrl: string;
  onClose: () => void;
}) {
  return (
    <div className="compare-overlay" onMouseDown={onClose}>
      <div className="compare-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="compare-head">
          <strong>{title}</strong>
          <span className="hint">Draft previews build after the push — if the right side 404s, give Vercel a minute.</span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="compare-panes">
          <div className="compare-pane">
            <span className="badge">current</span>
            {mainUrl ? <iframe src={mainUrl} title="Current" /> : <div className="hint">No preview for main</div>}
          </div>
          <div className="compare-pane">
            <span className="badge draft">draft</span>
            <iframe src={draftUrl} title="Draft" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Creator-only popover: team/private visibility + explicit members on private projects. */
function SharingSettings({ project, me, users }: { project: Doc<"projects">; me: Doc<"users">; users: Doc<"users">[] }) {
  const [open, setOpen] = useState(false);
  const setVisibility = useMutation(api.projects.setVisibility);
  const setMembers = useMutation(api.projects.setMembers);
  const moveProject = useMutation(api.workspaces.moveProject);
  const setShareToken = useMutation(api.projects.setShareToken);
  const [linkCopied, setLinkCopied] = useState(false);
  const myWorkspaces = useQuery(api.workspaces.mine, open ? { userId: me._id, sessionToken: sessionToken() } : "skip");
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);
  const shareUrl = project.shareToken
    ? `${(getConvexUrl() ?? "").replace(".convex.cloud", ".convex.site")}/p/${project.shareToken}`
    : null;

  const memberIds = project.memberIds ?? [];
  const isPrivate = project.visibility === "private";
  const toggleMember = (userId: Id<"users">) => {
    const next = memberIds.includes(userId) ? memberIds.filter((id) => id !== userId) : [...memberIds, userId];
    void setMembers({ projectId: project._id, userId: me._id, memberIds: next });
  };

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className={`btn ghost ${open ? "active" : ""}`}
        title={isPrivate ? "Private — only you and added members" : "Visible to the whole team"}
        onClick={() => setOpen(!open)}
      >
        {isPrivate ? "🔒 Private" : "Sharing"}
      </button>
      {open && (
        <div className="titlebar-popover" style={{ padding: 12 }}>
          <div className="seg" style={{ display: "flex", marginBottom: 10 }}>
            <button
              className={!isPrivate ? "on" : ""}
              style={{ flex: 1 }}
              onClick={() => setVisibility({ projectId: project._id, userId: me._id, visibility: "team" })}
            >
              Team
            </button>
            <button
              className={isPrivate ? "on" : ""}
              style={{ flex: 1 }}
              onClick={() => setVisibility({ projectId: project._id, userId: me._id, visibility: "private" })}
            >
              Private
            </button>
          </div>
          {isPrivate ? (
            <>
              <div className="hint" style={{ marginBottom: 6 }}>
                Members can see the project and be @mentioned:
              </div>
              {users
                .filter((u) => u._id !== me._id)
                .map((u) => (
                  <label key={u._id} className="member-row">
                    <input type="checkbox" checked={memberIds.includes(u._id)} onChange={() => toggleMember(u._id)} />
                    <span className="avatar" style={{ background: u.avatarColor }}>
                      {u.avatarUrl ? <img src={u.avatarUrl} alt="" /> : initials(u.name)}
                    </span>
                    {u.name}
                  </label>
                ))}
            </>
          ) : (
            <div className="hint">Everyone in this project's workspace can see and comment on it.</div>
          )}
          <div className="hint" style={{ margin: "10px 0 4px" }}>
            Web link — read-only snapshot canvas for anyone, no install:
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {shareUrl ? (
              <>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={() => {
                    void navigator.clipboard.writeText(shareUrl);
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 1500);
                  }}
                >
                  {linkCopied ? "Copied" : "Copy web link"}
                </button>
                <button
                  className="btn ghost"
                  title="Revoke — the link stops working immediately"
                  onClick={() => void setShareToken({ projectId: project._id, userId: me._id, sessionToken: sessionToken(), enable: false })}
                >
                  Revoke
                </button>
              </>
            ) : (
              <button
                className="btn ghost"
                style={{ flex: 1 }}
                onClick={() => void setShareToken({ projectId: project._id, userId: me._id, sessionToken: sessionToken(), enable: true })}
              >
                Create web link
              </button>
            )}
          </div>
          {myWorkspaces && myWorkspaces.length > 1 && (
            <>
              <div className="hint" style={{ margin: "10px 0 4px" }}>
                Workspace — who this project belongs to:
              </div>
              <select
                value={project.workspaceId ?? ""}
                onChange={(e) =>
                  void moveProject({
                    projectId: project._id,
                    workspaceId: e.target.value as Id<"workspaces">,
                    userId: me._id,
                    sessionToken: sessionToken(),
                  })
                }
              >
                {myWorkspaces.map((w) => (
                  <option key={w._id} value={w._id}>
                    {w.name}
                    {w.kind === "personal" ? " (just you)" : ` (${w.members.length} members)`}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  me: Doc<"users">;
  nav: Extract<Nav, { screen: "project" }>;
  setNav: (nav: Nav) => void;
}

export default function ProjectView({ me, nav, setNav }: Props) {
  const project = useQuery(api.projects.get, { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() });
  const framesQuery = useQuery(api.projects.frames, { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() });
  const frames = framesQuery ?? [];
  const threads = useQuery(api.comments.threadsForProject, { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() }) ?? [];
  const users = useQuery(api.workspaces.membersForProject, { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() }) ?? [];
  const activeUsers = useQuery(api.presence.activeInProject, { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() }) ?? [];
  const heartbeat = useMutation(api.presence.heartbeat);
  const linkRepo = useMutation(api.repoLinks.link);
  const setGitRemote = useMutation(api.projects.setGitRemote);
  const rediscover = useMutation(api.projects.rediscover);

  // This user's working copy on this machine (paths differ per teammate).
  const machineId = useMachineId();
  const repoLink = useQuery(
    api.repoLinks.forUser,
    machineId ? { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken(), machineId } : "skip"
  );
  const repoPath = repoLink?.repoPath;
  // Which teammates have live frames — drives viewer empty states.
  const repoHolders = useQuery(api.repoLinks.holders, { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() }) ?? [];
  const holderNames = repoHolders.filter((h) => h.userId !== me._id).map((h) => h.name);

  const [devStatus, setDevStatus] = useState<DevServerStatus>({ state: "stopped" });
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cloning, setCloning] = useState(false);

  // Ambient git: drift is visible on the chip; a fast-forward pull onto a
  // clean tree can't conflict, so that case syncs automatically. Dirty or
  // diverged trees get a manual button instead — Commons never risks WIP.
  const [gitStatus, setGitStatus] = useState<GitRepoStatus | null>(null);
  useEffect(() => {
    if (!repoPath || !window.commons) {
      setGitStatus(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const status = await window.commons.getGitStatus(repoPath).catch(() => null);
      if (cancelled) return;
      setGitStatus(status);
      if (status && !status.dirty && status.ahead === 0 && status.behind > 0) {
        const pulled = await window.commons.pullRepo(repoPath).catch(() => null);
        if (!cancelled && pulled?.ok) setGitStatus({ ...status, behind: 0 });
      }
    };
    void poll();
    const interval = setInterval(poll, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [repoPath]);

  // Rung 2: teammates without a clone get one from the project's gitRemote.
  const cloneProject = async () => {
    if (!project?.gitRemote || !window.commons || cloning) return;
    setCloning(true);
    try {
      const result = await window.commons.cloneRepo(project.gitRemote, project.name);
      if (result && "repoPath" in result) {
        await linkRepo({ projectId: nav.projectId, userId: me._id, repoPath: result.repoPath, machineId: machineId ?? undefined });
      } else if (result && "error" in result) {
        alert(`Clone failed: ${result.error}`);
      }
    } finally {
      setCloning(false);
    }
  };

  // Nudge the person who CAN fix it: repo-holders on projects teammates can't see.
  const nudgeKey = `commons.previewNudge.${nav.projectId}`;
  const [nudgeDismissed, setNudgeDismissed] = useState(() => localStorage.getItem(nudgeKey) === "1");
  const showPreviewNudge =
    !!repoPath && !!project && !project.previewUrl && users.length > 1 && !nudgeDismissed;

  // "Since you were last here" (#4) — one glance instead of hunting for what
  // changed. Snapshot the first non-null result so live churn doesn't mutate
  // the strip while it's being read; dismiss lasts for this project visit.
  const catchUpLive = useQuery(api.projects.catchUp, { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() });
  const [catchUp, setCatchUpSnapshot] = useState<typeof catchUpLive>(undefined);
  const [catchUpDismissed, setCatchUpDismissed] = useState(false);
  useEffect(() => {
    if (catchUpLive && catchUp === undefined) setCatchUpSnapshot(catchUpLive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catchUpLive]);

  // Which test's clicks are overlaid on the canvas ("Clicks on canvas" in
  // the user-tests results panel). Convex feeds the dots live.
  const [heatmapTestId, setHeatmapTestId] = useState<Id<"tests"> | null>(null);
  const heatmapData = useQuery(
    api.userTests.heatmap,
    heatmapTestId ? { testId: heatmapTestId, userId: me._id, sessionToken: sessionToken() } : "skip"
  );

  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [activeAgentSessionId, setActiveAgentSessionId] = useState<string | null>(null);
  // Current-vs-draft side-by-side (PRJ-14), opened from a draft result row.
  const [compare, setCompare] = useState<{ title: string; routePath?: string; draftPreviewUrl: string } | null>(null);
  // Per-frame counters bumped when an agent finishes editing; keys the frame iframes.
  const [frameReloadTokens, setFrameReloadTokens] = useState<Record<string, number>>({});

  // Mirrored sessions are the source of truth for the panel (whole team sees them).
  const convexSessions = useQuery(api.agentSessions.forProject, { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() }) ?? [];
  const createAgentSession = useMutation(api.agentSessions.create);
  const appendAgentEvent = useMutation(api.agentSessions.appendEvent);

  // Convex session id ↔ local (main-process) session id, host side only.
  const [mirrorMap, setMirrorMap] = useState<Record<string, string>>({}); // convexId → localId
  const convexIdByLocal = useRef<Record<string, string>>({});
  const mirrorQueue = useRef<Promise<unknown>>(Promise.resolve());

  const rememberMapping = (localId: string, convexId: string) => {
    convexIdByLocal.current[localId] = convexId;
    setMirrorMap((prev) => ({ ...prev, [convexId]: localId }));
  };

  // Rebuild the mapping after a renderer reload — main-process sessions survive it.
  useEffect(() => {
    if (!window.commons) return;
    window.commons.listAgentSessions().then((list) => {
      for (const info of list) {
        if (info.context.mirrorSessionId) rememberMapping(info.sessionId, info.context.mirrorSessionId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Host side: forward every local agent event into Convex, in order.
  useEffect(() => {
    if (!window.commons) return;
    return window.commons.onAgentEvent((localId, event) => {
      const convexId = convexIdByLocal.current[localId];
      if (!convexId) return;
      mirrorQueue.current = mirrorQueue.current
        .then(() => appendAgentEvent({ sessionId: convexId as Id<"agentSessions">, event }))
        .catch((err) => console.error("agent event mirror failed", err));
    });
  }, [appendAgentEvent]);

  const postAgentReply = useMutation(api.comments.postAgentReply);
  const generateUploadUrl = useMutation(api.comments.generateUploadUrl);
  const saveFrameSnapshot = useMutation(api.projects.saveFrameSnapshot);

  // SNAP-3: while this machine has live frames, keep one fresh snapshot per
  // frame (stale after 30 min). Captures run serially in the main process;
  // one attempt per frame per app session keeps this quiet.
  const snapshotAttempted = useRef(new Set<string>());
  useEffect(() => {
    if (devStatus.state !== "ready" || !window.commons?.captureSnapshot) return;
    const stale = frames.filter(
      (f) =>
        f.kind === "route" &&
        !snapshotAttempted.current.has(f._id) &&
        (f.snapshotAt == null || Date.now() - f.snapshotAt > 30 * 60_000)
    );
    for (const frame of stale) snapshotAttempted.current.add(frame._id);
    void (async () => {
      for (const frame of stale) {
        const url = resolveFrameUrl(frame.routePath, devStatus, null)?.url;
        if (!url) continue;
        try {
          const png = await window.commons.captureSnapshot(url, { width: frame.width, height: frame.height });
          if (!png) continue;
          const uploadUrl = await generateUploadUrl();
          const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": "image/png" },
            body: new Blob([png as BlobPart], { type: "image/png" }),
          });
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
          await saveFrameSnapshot({ frameId: frame._id, storageId, userId: me._id, sessionToken: sessionToken() });
        } catch (err) {
          console.warn("frame snapshot failed", frame.title, err);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devStatus.state, frames.length]);

  /**
   * SNAP-2: before/after images on draft results. "Before" is the current
   * preview at the session's route; "after" is the draft branch's deploy
   * preview once Vercel finishes building it (minutes) — so this runs fire-
   * and-forget and posts a follow-up image reply when both are in hand.
   */
  const postBeforeAfter = (session: AgentSessionInfo, draftPreviewUrl: string) => {
    if (!window.commons?.captureSnapshot || !session.context.threadId) return;
    const routePath = session.context.routePath ?? "/";
    const frame = session.context.frameId ? frames.find((f) => f._id === session.context.frameId) : undefined;
    const size = { width: frame?.width ?? 1280, height: frame?.height ?? 800 };
    const beforeUrl = resolveFrameUrl(routePath, devStatus, project?.previewUrl)?.url;
    if (!beforeUrl) return;

    const upload = async (png: Uint8Array) => {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Blob([png as BlobPart], { type: "image/png" }),
      });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      return storageId;
    };

    void (async () => {
      try {
        // Capture "before" immediately — main will change once the PR merges.
        const before = await window.commons.captureSnapshot(beforeUrl, size);
        const after = await window.commons.captureSnapshot(`${draftPreviewUrl}${routePath}`, {
          ...size,
          waitForDeploy: true,
        });
        if (!before || !after) return;
        const [beforeId, afterId] = await Promise.all([upload(before), upload(after)]);
        await postAgentReply({
          threadId: session.context.threadId as Id<"threads">,
          hostUserId: me._id,
          sessionToken: sessionToken(),
          body: `📸 Before → after (${routePath})`,
          images: [beforeId, afterId],
        });
      } catch (err) {
        console.warn("before/after snapshot failed", err);
      }
    })();
  };

  const handleAgentResult = (session: AgentSessionInfo, event: AgentResultEvent) => {
    if (session.context.projectId !== nav.projectId) return;
    if (!event.ok) return;

    // Close the loop where the feedback started: the host posts the agent's
    // summary back to the originating thread.
    if (session.context.threadId) {
      const summary = event.summary.length > 1000 ? `${event.summary.slice(0, 997)}…` : event.summary;
      const files = event.editedFiles.length > 0 ? `\n\nChanged: ${event.editedFiles.join(", ")}` : "";
      const draftRoute = session.context.routePath ?? "";
      const draftNote = event.draft
        ? `\n\nDraft branch: ${event.draft.branch}${
            event.draft.previewUrl ? `\nView draft: ${event.draft.previewUrl}${draftRoute}` : ""
          }${
            event.draft.compareUrl
              ? `\nShip it: ${event.draft.compareUrl}`
              : event.draft.committed && !event.draft.pushed
                ? "\n(committed locally — push failed, ask the host to check git credentials)"
                : ""
          }`
        : "";
      void postAgentReply({
        threadId: session.context.threadId as Id<"threads">,
        hostUserId: me._id,
        sessionToken: sessionToken(),
        body: `⚡ Agent finished: ${summary}${files}${draftNote}`,
      }).catch((err) => console.error("agent thread reply failed", err));

      if (event.draft?.previewUrl && event.editedFiles.length > 0) {
        postBeforeAfter(session, event.draft.previewUrl);
      }
    }

    // Draft edits live on their branch, not in the local tree — no reload.
    if (event.editedFiles.length === 0 || event.draft) return;
    // Reload the frame the session targeted; canvas-level sessions reload everything.
    const targets = session.context.frameId ? [session.context.frameId] : frames.map((f) => f._id as string);
    setFrameReloadTokens((prev) => {
      const next = { ...prev };
      for (const id of targets) next[id] = (next[id] ?? 0) + 1;
      return next;
    });
  };

  const agentControl = useAgentSessions(handleAgentResult);
  const runningCount = convexSessions.filter((s) => s.status === "running" || s.status === "starting").length;

  useEffect(
    () => registerShortcut("a", () => setAgentPanelOpen((open) => !open), { description: "Agent sessions" }),
    []
  );

  // Shared launcher for every agent entry point (threads, test results).
  // Draft mode (project has a git remote) runs in a Commons-managed checkout
  // on a fresh branch; classic in-place mode is the remote-less fallback.
  const startAgentSession = async (opts: {
    title: string;
    prompt: string;
    threadId?: Id<"threads">;
    frameId?: Id<"frames">;
    routePath?: string;
  }) => {
    const draftMode = !!project?.gitRemote;
    if (!draftMode && !repoPath) return;
    const mirrorId = await createAgentSession({
      projectId: nav.projectId,
      hostUserId: me._id,
      adapter: "claude-code",
      title: opts.title,
      threadId: opts.threadId,
      frameId: opts.frameId,
      routePath: opts.routePath,
    });
    const info = await agentControl.start({
      ...(draftMode
        ? {
            gitRemote: project!.gitRemote,
            draftSlug: slugify(opts.title),
            branchPreviewPattern: project!.branchPreviewPattern,
          }
        : { repoPath: repoPath! }),
      prompt: opts.prompt,
      title: opts.title,
      context: {
        projectId: nav.projectId,
        threadId: opts.threadId,
        frameId: opts.frameId,
        routePath: opts.routePath,
        mirrorSessionId: mirrorId,
      },
    });
    rememberMapping(info.sessionId, mirrorId);
    setActiveAgentSessionId(mirrorId);
    setAgentPanelOpen(true);
  };

  const sendThreadToAgent = async (thread: ThreadWithMessages) => {
    const frame = thread.frameId ? frames.find((f) => f._id === thread.frameId) : undefined;
    const firstBody = thread.messages[0]?.body ?? "Comment thread";
    const title = firstBody.length > 60 ? `${firstBody.slice(0, 57)}…` : firstBody;
    await startAgentSession({
      title,
      prompt: buildThreadPrompt(thread, frame),
      threadId: thread._id,
      frameId: thread.frameId,
      routePath: frame?.routePath,
    });
  };

  const panelSessions: PanelSession[] = convexSessions.map((s) => ({
    id: s._id,
    title: s.title,
    status: s.status,
    routePath: s.routePath,
    hostName: s.host?.name,
    canControl: s.hostUserId === me._id && !!mirrorMap[s._id],
  }));
  const activePanelId = activeAgentSessionId ?? convexSessions[0]?._id ?? null;
  const transcript = (useQuery(
    api.agentSessions.events,
    activePanelId ? { sessionId: activePanelId as Id<"agentSessions">, userId: me._id } : "skip"
  ) ?? []) as AgentSessionEvent[];

  // Presence heartbeat while the project is open.
  useEffect(() => {
    heartbeat({ userId: me._id, projectId: nav.projectId });
    const interval = setInterval(() => heartbeat({ userId: me._id, projectId: nav.projectId }), 15_000);
    return () => clearInterval(interval);
  }, [me._id, nav.projectId, heartbeat]);

  // Start the dev server for local code projects and track its status.
  useEffect(() => {
    if (!repoPath || !window.commons) return;
    let cancelled = false;
    window.commons.getDevServerStatus(repoPath).then((status) => {
      if (cancelled) return;
      setDevStatus(status);
      if (status.state === "stopped") {
        window.commons.startDevServer(repoPath).then((s) => !cancelled && setDevStatus(s));
      }
    });
    const unsubscribe = window.commons.onDevServerStatus((path, status) => {
      if (path === repoPath) setDevStatus(status);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repoPath]);

  const copyLink = () => {
    navigator.clipboard.writeText(
      buildDeepLink({ projectId: nav.projectId, view: nav.view, threadId: nav.threadId })
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const locateRepo = async () => {
    if (!window.commons) return;
    const inspection = await window.commons.pickRepo();
    if (!inspection) return;
    await linkRepo({ projectId: nav.projectId, userId: me._id, repoPath: inspection.repoPath, machineId: machineId ?? undefined });
    if (inspection.gitRemote && !project?.gitRemote) {
      await setGitRemote({ projectId: nav.projectId, gitRemote: inspection.gitRemote });
    }
    // Backfill frames for projects added before their framework was supported.
    if (frames.length === 0 && inspection.routes.length > 0) {
      await rediscover({
        projectId: nav.projectId,
        framework: inspection.framework,
        brandColors: inspection.brandColors,
        frames: layoutFrames(inspection),
      });
    }
  };

  // A linked repo but an empty canvas means discovery never ran (project
  // predates its framework support, or discovery failed) — run it now.
  const autoDiscovered = useRef(false);
  useEffect(() => {
    if (autoDiscovered.current || !repoPath || !window.commons) return;
    if (framesQuery === undefined || framesQuery.length > 0) return;
    autoDiscovered.current = true;
    (async () => {
      const inspection = await window.commons.inspectRepo(repoPath);
      if (inspection.routes.length === 0) return;
      await rediscover({
        projectId: nav.projectId,
        framework: inspection.framework,
        brandColors: inspection.brandColors,
        frames: layoutFrames(inspection),
      });
    })().catch((err) => console.error("auto-discovery failed", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, framesQuery]);

  // Re-derive the section layout from the repo and move all frames into it.
  const tidyCanvas = async () => {
    if (!repoPath || !window.commons) return;
    if (!window.confirm("Re-lay out all frames by section? This moves frames for everyone on the team.")) return;
    const inspection = await window.commons.inspectRepo(repoPath);
    await rediscover({
      projectId: nav.projectId,
      framework: inspection.framework,
      brandColors: inspection.brandColors,
      frames: layoutFrames(inspection),
      relayout: true,
    });
  };

  if (!project) return <div className="center-screen hint">Loading project…</div>;

  // On private projects only members can be @mentioned (the backend enforces
  // this too — the composer just shouldn't offer names that would be dropped).
  const mentionUsers =
    project.visibility === "private"
      ? users.filter((u) => u._id === project.createdBy || (project.memberIds ?? []).includes(u._id))
      : users;

  return (
    <div className="app">
      <div className="titlebar">
        <button className="btn ghost" onClick={() => setNav({ screen: "home" })}>
          ←
        </button>
        <span className="crumb">
          Projects / <strong>{project.name}</strong>
        </span>
        <div className="seg">
          <button className={nav.view === "canvas" ? "on" : ""} onClick={() => setNav({ ...nav, view: "canvas" })}>
            Canvas
          </button>
          <button
            className={nav.view === "prototype" ? "on" : ""}
            onClick={() => setNav({ ...nav, view: "prototype" })}
          >
            Prototype
          </button>
        </div>
        <span className="spacer" />
        {repoPath ? (
          <>
            <span className="status-chip" title={devStatus.state === "error" ? devStatus.message : repoPath}>
              <span className={`status-dot ${devStatus.state}`} />
              {devStatus.state === "ready"
                ? `dev · :${devStatus.port}`
                : devStatus.state === "starting"
                  ? "starting…"
                  : devStatus.state === "error"
                    ? "dev error"
                    : "stopped"}
              {gitStatus && (
                <span className="git-bit" title={gitStatus.dirty ? "Local changes present" : "Working tree clean"}>
                  {gitStatus.branch}
                  {gitStatus.behind > 0 && ` ↓${gitStatus.behind}`}
                  {gitStatus.ahead > 0 && ` ↑${gitStatus.ahead}`}
                  {gitStatus.dirty && " •"}
                </span>
              )}
            </span>
            {gitStatus && gitStatus.behind > 0 && (gitStatus.dirty || gitStatus.ahead > 0) && (
              <button
                className="btn ghost"
                title={
                  gitStatus.dirty
                    ? "Origin moved, but you have local changes — Commons won't pull over them"
                    : "Your branch and origin diverged — pull manually when ready"
                }
                onClick={async () => {
                  const result = await window.commons.pullRepo(repoPath);
                  if (!result.ok) alert(result.message);
                }}
              >
                Pull ↓{gitStatus.behind}
              </button>
            )}
          </>
        ) : (
          <>
            {project.gitRemote && (
              <button className="btn" disabled={cloning} onClick={cloneProject} title={project.gitRemote}>
                {cloning ? "Cloning…" : "Get this project"}
              </button>
            )}
            <button className={project.gitRemote ? "btn ghost" : "btn"} onClick={locateRepo}>
              {project.gitRemote ? "Locate existing clone…" : "Locate repo on this Mac"}
            </button>
          </>
        )}
        {project.createdBy === me._id && <SharingSettings project={project} me={me} users={users} />}
        <PreviewSettings project={project} open={previewOpen} onOpenChange={setPreviewOpen} />
        {(repoPath || project.gitRemote || convexSessions.length > 0) && (
          <button
            className={`btn ghost ${agentPanelOpen ? "active" : ""}`}
            title="Agent sessions (A)"
            onClick={() => setAgentPanelOpen((open) => !open)}
          >
            ⚡{runningCount > 0 ? ` ${runningCount}` : ""}
          </button>
        )}
        <button className="btn" onClick={copyLink}>
          {copied ? "Copied" : "Copy link"}
        </button>
        <ThemeToggle />
        <div className="avatar-stack">
          {activeUsers.map(
            (user) =>
              user && (
                <span key={user._id} className="avatar" style={{ background: user.avatarColor }} title={user.name}>
                  {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}
                </span>
              )
          )}
        </div>
        <Inbox me={me} setNav={setNav} />
      </div>

      {catchUp && !catchUpDismissed && (
        <div className="nudge-banner catchup">
          <span>
            Since you were last here:{" "}
            {[
              catchUp.newThreads > 0 && `${catchUp.newThreads} new thread${catchUp.newThreads === 1 ? "" : "s"}`,
              catchUp.newReplies > 0 && `${catchUp.newReplies} repl${catchUp.newReplies === 1 ? "y" : "ies"}`,
              catchUp.newAgentSessions > 0 &&
                `${catchUp.newAgentSessions} agent session${catchUp.newAgentSessions === 1 ? "" : "s"}`,
              catchUp.newTestSessions > 0 &&
                `${catchUp.newTestSessions} test session${catchUp.newTestSessions === 1 ? "" : "s"} completed`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <button className="btn ghost" onClick={() => setCatchUpDismissed(true)}>
            ✕
          </button>
        </div>
      )}

      {showPreviewNudge && (
        <div className="nudge-banner">
          <span>
            Teammates without the repo see empty frames — publish a deploy preview so everyone can follow along.
          </span>
          <button className="btn" onClick={() => setPreviewOpen(true)}>
            Set preview URL
          </button>
          <button
            className="btn ghost"
            title="Dismiss for this project"
            onClick={() => {
              localStorage.setItem(nudgeKey, "1");
              setNudgeDismissed(true);
            }}
          >
            ✕
          </button>
        </div>
      )}

      {nav.view === "canvas" ? (
        <CanvasView
          me={me}
          projectId={nav.projectId}
          frames={frames}
          threads={threads}
          users={users}
          mentionUsers={mentionUsers}
          devStatus={devStatus}
          previewUrl={project.previewUrl}
          viewerHasRepo={!!repoPath}
          repoHolderNames={holderNames}
          initialThreadId={nav.threadId}
          initialFrameId={nav.frameId}
          frameReloadTokens={frameReloadTokens}
          onSendToAgent={repoPath || project.gitRemote ? sendThreadToAgent : undefined}
          onTidy={repoPath ? tidyCanvas : undefined}
          heatmap={
            heatmapTestId && heatmapData
              ? { ...heatmapData, onClear: () => setHeatmapTestId(null) }
              : undefined
          }
        />
      ) : (
        <PrototypeView
          frames={frames}
          devStatus={devStatus}
          previewUrl={project.previewUrl}
          viewerHasRepo={!!repoPath}
          repoHolderNames={holderNames}
          project={project}
          me={me}
          onShowHeatmap={(testId) => {
            setHeatmapTestId(testId);
            setNav({ ...nav, view: "canvas" });
          }}
          onSendToAgent={
            repoPath || project.gitRemote
              ? (title, prompt, routePath) => void startAgentSession({ title, prompt, routePath })
              : undefined
          }
        />
      )}

      {agentPanelOpen && (
        <AgentPanel
          sessions={panelSessions}
          transcript={transcript}
          activeSessionId={activePanelId}
          onSelectSession={setActiveAgentSessionId}
          onSendPrompt={(convexId, text) => {
            const localId = mirrorMap[convexId];
            return localId ? agentControl.sendPrompt(localId, text) : Promise.resolve();
          }}
          onStop={(convexId) => {
            const localId = mirrorMap[convexId];
            if (localId) void agentControl.stop(localId);
          }}
          onClose={() => setAgentPanelOpen(false)}
          onCompareDraft={(draftPreviewUrl, routePath, title) =>
            setCompare({ draftPreviewUrl, routePath, title })
          }
        />
      )}

      {compare && (
        <CompareDraft
          title={compare.title}
          mainUrl={resolveFrameUrl(compare.routePath ?? "/", devStatus, project.previewUrl)?.url ?? null}
          draftUrl={`${compare.draftPreviewUrl}${compare.routePath ?? ""}`}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}
