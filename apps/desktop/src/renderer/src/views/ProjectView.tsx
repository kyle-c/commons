import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import type { AgentSessionEvent, AgentSessionInfo, DevServerStatus } from "@commons/shared";
import { buildDeepLink } from "@commons/shared";
import type { Nav } from "../App";
import type { ThreadWithMessages } from "../comments/types";
import CanvasView from "../canvas/CanvasView";
import PrototypeView from "./PrototypeView";
import Inbox from "./Inbox";
import AgentPanel, { type PanelSession } from "../agents/AgentPanel";
import ThemeToggle from "./ThemeToggle";
import { useAgentSessions, type AgentResultEvent } from "../agents/useAgentSessions";
import { initials } from "../lib/session";
import { registerShortcut } from "../lib/shortcuts";
import { layoutFrames } from "../lib/frameLayout";
import { useClickOutside } from "../lib/useClickOutside";

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
  const setPreviewUrl = useMutation(api.projects.setPreviewUrl);
  const trimmed = value.trim();
  const valid = trimmed === "" || /^https?:\/\/.+/.test(trimmed);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className={`btn ghost ${open ? "active" : ""}`}
        title="Where teammates without the repo see this project — frames fall back to this deployed URL when no local dev server is running"
        onClick={() => {
          setValue(project.previewUrl ?? "");
          setOpen(!open);
        }}
      >
        Preview URL{project.previewUrl ? "" : " ⚠"}
      </button>
      {open && (
        <div className="titlebar-popover">
          <label className="hint">Deployed preview base URL (e.g. a Vercel deployment)</label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://myapp-git-main-team.vercel.app"
            autoFocus
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn"
              disabled={!valid}
              onClick={async () => {
                await setPreviewUrl({
                  projectId: project._id,
                  previewUrl: trimmed === "" ? undefined : trimmed.replace(/\/+$/, ""),
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

/** Creator-only popover: team/private visibility + explicit members on private projects. */
function SharingSettings({ project, me, users }: { project: Doc<"projects">; me: Doc<"users">; users: Doc<"users">[] }) {
  const [open, setOpen] = useState(false);
  const setVisibility = useMutation(api.projects.setVisibility);
  const setMembers = useMutation(api.projects.setMembers);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

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
            <div className="hint">Everyone on the team can see and comment on this project.</div>
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
  const project = useQuery(api.projects.get, { projectId: nav.projectId, userId: me._id });
  const framesQuery = useQuery(api.projects.frames, { projectId: nav.projectId, userId: me._id });
  const frames = framesQuery ?? [];
  const threads = useQuery(api.comments.threadsForProject, { projectId: nav.projectId, userId: me._id }) ?? [];
  const users = useQuery(api.users.list) ?? [];
  const activeUsers = useQuery(api.presence.activeInProject, { projectId: nav.projectId, userId: me._id }) ?? [];
  const heartbeat = useMutation(api.presence.heartbeat);
  const linkRepo = useMutation(api.repoLinks.link);
  const setGitRemote = useMutation(api.projects.setGitRemote);
  const rediscover = useMutation(api.projects.rediscover);

  // This user's working copy on this machine (paths differ per teammate).
  const repoLink = useQuery(api.repoLinks.forUser, { projectId: nav.projectId, userId: me._id });
  const repoPath = repoLink?.repoPath;
  // Which teammates have live frames — drives viewer empty states.
  const repoHolders = useQuery(api.repoLinks.holders, { projectId: nav.projectId, userId: me._id }) ?? [];
  const holderNames = repoHolders.filter((h) => h.userId !== me._id).map((h) => h.name);

  const [devStatus, setDevStatus] = useState<DevServerStatus>({ state: "stopped" });
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Nudge the person who CAN fix it: repo-holders on projects teammates can't see.
  const nudgeKey = `commons.previewNudge.${nav.projectId}`;
  const [nudgeDismissed, setNudgeDismissed] = useState(() => localStorage.getItem(nudgeKey) === "1");
  const showPreviewNudge =
    !!repoPath && !!project && !project.previewUrl && users.length > 1 && !nudgeDismissed;

  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [activeAgentSessionId, setActiveAgentSessionId] = useState<string | null>(null);
  // Per-frame counters bumped when an agent finishes editing; keys the frame iframes.
  const [frameReloadTokens, setFrameReloadTokens] = useState<Record<string, number>>({});

  // Mirrored sessions are the source of truth for the panel (whole team sees them).
  const convexSessions = useQuery(api.agentSessions.forProject, { projectId: nav.projectId, userId: me._id }) ?? [];
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

  const replyToThread = useMutation(api.comments.reply);

  const handleAgentResult = (session: AgentSessionInfo, event: AgentResultEvent) => {
    if (session.context.projectId !== nav.projectId) return;
    if (!event.ok) return;

    // Close the loop where the feedback started: the host posts the agent's
    // summary back to the originating thread.
    if (session.context.threadId) {
      const summary = event.summary.length > 1000 ? `${event.summary.slice(0, 997)}…` : event.summary;
      const files = event.editedFiles.length > 0 ? `\n\nChanged: ${event.editedFiles.join(", ")}` : "";
      void replyToThread({
        threadId: session.context.threadId as Id<"threads">,
        authorId: me._id,
        body: `⚡ Agent finished: ${summary}${files}`,
        mentions: [],
      }).catch((err) => console.error("agent thread reply failed", err));
    }

    if (event.editedFiles.length === 0) return;
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

  const sendThreadToAgent = async (thread: ThreadWithMessages) => {
    if (!repoPath) return;
    const frame = thread.frameId ? frames.find((f) => f._id === thread.frameId) : undefined;
    const firstBody = thread.messages[0]?.body ?? "Comment thread";
    const title = firstBody.length > 60 ? `${firstBody.slice(0, 57)}…` : firstBody;
    const mirrorId = await createAgentSession({
      projectId: nav.projectId,
      hostUserId: me._id,
      adapter: "claude-code",
      title,
      threadId: thread._id,
      frameId: thread.frameId,
      routePath: frame?.routePath,
    });
    const info = await agentControl.start({
      repoPath,
      prompt: buildThreadPrompt(thread, frame),
      title,
      context: {
        projectId: nav.projectId,
        threadId: thread._id,
        frameId: thread.frameId,
        routePath: frame?.routePath,
        mirrorSessionId: mirrorId,
      },
    });
    rememberMapping(info.sessionId, mirrorId);
    setActiveAgentSessionId(mirrorId);
    setAgentPanelOpen(true);
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
    await linkRepo({ projectId: nav.projectId, userId: me._id, repoPath: inspection.repoPath });
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
          <span className="status-chip" title={devStatus.state === "error" ? devStatus.message : repoPath}>
            <span className={`status-dot ${devStatus.state}`} />
            {devStatus.state === "ready"
              ? `dev · :${devStatus.port}`
              : devStatus.state === "starting"
                ? "starting…"
                : devStatus.state === "error"
                  ? "dev error"
                  : "stopped"}
          </span>
        ) : (
          <button className="btn" onClick={locateRepo}>
            Locate repo on this Mac
          </button>
        )}
        {project.createdBy === me._id && <SharingSettings project={project} me={me} users={users} />}
        <PreviewSettings project={project} open={previewOpen} onOpenChange={setPreviewOpen} />
        {(repoPath || convexSessions.length > 0) && (
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
          onSendToAgent={repoPath ? sendThreadToAgent : undefined}
          onTidy={repoPath ? tidyCanvas : undefined}
        />
      ) : (
        <PrototypeView
          frames={frames}
          devStatus={devStatus}
          previewUrl={project.previewUrl}
          viewerHasRepo={!!repoPath}
          repoHolderNames={holderNames}
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
        />
      )}
    </div>
  );
}
