import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import type { AgentSessionEvent, AgentSessionInfo, DevServerStatus, GitRepoStatus } from "@commons/shared";
import { buildDeepLink } from "@commons/shared";
import type { Nav } from "../App";
import type { ThreadWithMessages } from "../comments/types";
import CanvasView from "../canvas/CanvasView";
import PrototypeView, { DEVICES, type ProtoDevice } from "./PrototypeView";
import Inbox from "./Inbox";
import AccountMenu from "./AccountMenu";
import ServersMenu from "./ServersMenu";
import WorkspacesMenu from "./WorkspacesMenu";
import Team from "./Team";
import AgentPanel, { type PanelSession } from "../agents/AgentPanel";
import NarrationPanel from "./NarrationPanel";
import { useAgentSessions, type AgentResultEvent } from "../agents/useAgentSessions";
import { getConvexUrl, initials, sessionToken } from "../lib/session";
import { resolveFrameUrl } from "../lib/frameUrl";
import { registerShortcut } from "../lib/shortcuts";
import { layoutFrames } from "../lib/frameLayout";
import { useClickOutside } from "../lib/useClickOutside";
import { useMachineId } from "../lib/machine";
import { getRecents, pushRecent } from "../lib/recents";
import Icon from "../components/icons";
import { PopSection, RevealField } from "../components/popover";

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

/**
 * Project setup, one quiet popover: your working copy on this machine and
 * the deployed preview URLs. An attention dot on the icon replaces the old
 * always-visible "Get this project / Locate / Preview URL ⚠" button row.
 */
function SetupPopover({
  project,
  repoPath,
  cloning,
  onClone,
  onLocate,
  open,
  onOpenChange,
}: {
  project: Doc<"projects">;
  repoPath?: string;
  cloning: boolean;
  onClone: () => void;
  onLocate: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
  const setPreviewUrl = useMutation(api.projects.setPreviewUrl);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);
  // Only when this machine can render nothing: no code here AND no preview.
  const needsAttention = !!window.commons && !repoPath && !project.previewUrl;

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className={`btn ghost icon-btn ${open ? "active" : ""}`}
        aria-label="Project setup"
        title="Project setup"
        onClick={() => setOpen(!open)}
      >
        <Icon name="sliders" />
        {needsAttention && <span className="attention-dot" />}
      </button>
      {open && (
        <div className="titlebar-popover setup-pop">
          {window.commons && (
            <>
              <PopSection label="On this Mac" />
              {repoPath ? (
                <div className="hint" style={{ padding: "0 14px 8px" }}>
                  ✓ Linked · running locally
                </div>
              ) : (
                <>
                  <div className="hint" style={{ padding: "0 14px 6px" }}>
                    With the code on this Mac, screens render live and you can run the agent.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 14px 10px" }}>
                    {project.gitRemote && (
                      <button className="btn" disabled={cloning} onClick={onClone} title={project.gitRemote}>
                        <Icon name="download" /> {cloning ? "Cloning…" : "Get the code"}
                      </button>
                    )}
                    <button className="btn ghost" onClick={onLocate}>
                      {project.gitRemote ? "I already have it…" : "Choose the folder…"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          <PopSection label="For everyone else" />
          <RevealField
            actionLabel="Preview link"
            icon="link"
            connected={!!project.previewUrl}
            placeholder="https://myapp.vercel.app"
            submitLabel="Save"
            allowEmpty
            initialValue={project.previewUrl ?? ""}
            hint="Teammates without the code see screens from this link, and user tests run against it."
            onSubmit={async (url) => {
              if (url && !/^https?:\/\/.+/.test(url)) throw new Error("Needs a full https:// link.");
              await setPreviewUrl({
                projectId: project._id,
                previewUrl: url ? url.replace(/\/+$/, "") : undefined,
              });
            }}
          />
          <RevealField
            actionLabel="Draft previews"
            icon="branch"
            connected={!!project.branchPreviewPattern}
            placeholder={"https://myapp-git-{branch}-team.vercel.app"}
            submitLabel="Save"
            allowEmpty
            initialValue={project.branchPreviewPattern ?? ""}
            hint={
              "Write {branch} where the branch name goes in your per-branch deploy link. Everyone sees agent drafts live, and A/B tests unlock."
            }
            onSubmit={async (patternValue) => {
              if (patternValue && (!/^https?:\/\/.+/.test(patternValue) || !patternValue.includes("{branch}")))
                throw new Error("Needs https:// and a {branch} placeholder.");
              await setPreviewUrl({
                projectId: project._id,
                previewUrl: project.previewUrl, // preserve — this field only sets the pattern
                branchPreviewPattern: patternValue ? patternValue.replace(/\/+$/, "") : undefined,
                hasBranchPattern: true,
              });
            }}
          />
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

/**
 * The titlebar's one loud control. Everyone gets the links (app deep link,
 * web link when minted); the creator additionally controls visibility,
 * members, web-link minting, and workspace.
 */
function SharePopover({
  project,
  me,
  users,
  nav,
}: {
  project: Doc<"projects">;
  me: Doc<"users">;
  users: Doc<"users">[];
  nav: Extract<Nav, { screen: "project" }>;
}) {
  const [open, setOpen] = useState(false);
  const setVisibility = useMutation(api.projects.setVisibility);
  const setMembers = useMutation(api.projects.setMembers);
  const moveProject = useMutation(api.workspaces.moveProject);
  const setShareToken = useMutation(api.projects.setShareToken);
  const [copied, setCopied] = useState<"app" | "web" | null>(null);
  const isCreator = project.createdBy === me._id;
  const myWorkspaces = useQuery(
    api.workspaces.mine,
    open && isCreator ? { userId: me._id, sessionToken: sessionToken() } : "skip"
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);
  const shareUrl = project.shareToken
    ? `${(getConvexUrl() ?? "").replace(".convex.cloud", ".convex.site")}/p/${project.shareToken}`
    : null;

  const copy = (kind: "app" | "web", text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  const memberIds = project.memberIds ?? [];
  const isPrivate = project.visibility === "private";
  const toggleMember = (userId: Id<"users">) => {
    const next = memberIds.includes(userId) ? memberIds.filter((id) => id !== userId) : [...memberIds, userId];
    void setMembers({ projectId: project._id, userId: me._id, memberIds: next });
  };

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className={`btn ${open ? "active" : ""}`}
        title={isPrivate ? "Private — only you and added members" : "Share this project"}
        onClick={() => setOpen(!open)}
      >
        <Icon name="share" /> Share
      </button>
      {open && (
        <div className="titlebar-popover">
          <PopSection label="Links" />
          <button
            className="link-row"
            onClick={() =>
              copy("app", buildDeepLink({ projectId: nav.projectId, view: nav.view, threadId: nav.threadId }))
            }
          >
            <Icon name={copied === "app" ? "check" : "link"} />
            <span className="lr-text">
              <span className="lr-title">{copied === "app" ? "Copied" : "Copy app link"}</span>
              <span className="lr-sub">Opens in Commons. Teammates only.</span>
            </span>
          </button>
          {shareUrl ? (
            <div className="link-row" role="button" tabIndex={0} onClick={() => copy("web", shareUrl)}>
              <Icon name={copied === "web" ? "check" : "link"} />
              <span className="lr-text">
                <span className="lr-title">{copied === "web" ? "Copied" : "Copy web link"}</span>
                <span className="lr-sub">Read-only canvas for anyone. No install.</span>
              </span>
              {isCreator && (
                <button
                  className="btn ghost quiet-action"
                  title="The link stops working immediately"
                  onClick={(e) => {
                    e.stopPropagation();
                    void setShareToken({ projectId: project._id, userId: me._id, sessionToken: sessionToken(), enable: false });
                  }}
                >
                  Revoke
                </button>
              )}
            </div>
          ) : isCreator ? (
            <button
              className="link-row"
              onClick={() => void setShareToken({ projectId: project._id, userId: me._id, sessionToken: sessionToken(), enable: true })}
            >
              <Icon name="share" />
              <span className="lr-text">
                <span className="lr-title">Create web link</span>
                <span className="lr-sub">Read-only canvas for anyone. No install.</span>
              </span>
            </button>
          ) : (
            <div className="hint" style={{ padding: "0 14px 8px" }}>
              No web link yet. The project's creator can mint one here.
            </div>
          )}
          {isCreator && (
            <>
              <PopSection label="Access" />
              <div style={{ padding: "0 14px 10px" }}>
                <div className="seg" style={{ display: "flex", marginBottom: 8 }}>
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
                          <input
                            type="checkbox"
                            checked={memberIds.includes(u._id)}
                            onChange={() => toggleMember(u._id)}
                          />
                          <span className="avatar" style={{ background: u.avatarColor }}>
                            {u.avatarUrl ? <img src={u.avatarUrl} alt="" /> : initials(u.name)}
                          </span>
                          {u.name}
                        </label>
                      ))}
                  </>
                ) : (
                  <div className="hint">Everyone in this workspace can see and comment.</div>
                )}
              </div>
              {myWorkspaces && myWorkspaces.length > 1 && (
                <div className="field-row">
                  <span className="hint">Workspace</span>
                  <span className="select-wrap">
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
                  </span>
                </div>
              )}
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
  /** The open-project tab strip (App owns the tab state). */
  tabStrip?: React.ReactNode;
  /** Report the loaded project's name so its tab can carry it. */
  onProjectName?: (projectId: string, name: string) => void;
  onSignOut: () => void;
}

export default function ProjectView({ me, nav, setNav, tabStrip, onProjectName, onSignOut }: Props) {
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
  // Legacy (pre-0.2.4) rows are candidates, not truth — never used directly.
  const repoLinkIsLegacy = !!repoLink && "legacy" in repoLink && repoLink.legacy === true;
  const repoPath = repoLink && !repoLinkIsLegacy ? repoLink.repoPath : undefined;

  // Claim-on-verify: if the candidate path is a working copy of this project
  // on this machine, link it properly (which retires the legacy row).
  const legacyClaimTried = useRef(false);
  useEffect(() => {
    if (legacyClaimTried.current || !repoLinkIsLegacy || !repoLink || !machineId || !window.commons) return;
    legacyClaimTried.current = true;
    void (async () => {
      try {
        const inspection = await window.commons.inspectRepo(repoLink.repoPath);
        // Same repo check, tolerant of .git suffix and trailing-slash drift.
        const norm = (r: string) => r.replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
        if (project?.gitRemote && inspection.gitRemote && norm(inspection.gitRemote) !== norm(project.gitRemote))
          return;
        await linkRepo({ projectId: nav.projectId, userId: me._id, repoPath: repoLink.repoPath, machineId });
      } catch {
        // Path isn't on this machine — leave the legacy row for its owner.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoLinkIsLegacy, machineId]);
  // Which teammates have live frames — drives viewer empty states.
  const repoHolders = useQuery(api.repoLinks.holders, { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() }) ?? [];
  const holderNames = repoHolders.filter((h) => h.userId !== me._id).map((h) => h.name);

  const [devStatus, setDevStatus] = useState<DevServerStatus>({ state: "stopped" });
  const [previewOpen, setPreviewOpen] = useState(false);
  // Prototype device, owned here because the titlebar's split view switcher
  // selects it: the Prototype segment shows the current device's icon and,
  // when already active, opens a small menu of the presets.
  const [chosenDevice, setChosenDevice] = useState<ProtoDevice | null>(null);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const deviceMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(deviceMenuRef, () => setDeviceMenuOpen(false), deviceMenuOpen);
  // Project switcher: name + dev status as one element, recents in the menu.
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  useClickOutside(switcherRef, () => setSwitcherOpen(false), switcherOpen);
  // Other prototypes this app instance is running — the switcher menu is the
  // one place to see and stop them (the standalone port viewer merged here).
  const [runningServers, setRunningServers] = useState<
    { repoPath: string; name?: string; status: DevServerStatus }[]
  >([]);
  const refreshServers = () => void window.commons?.listDevServers().then(setRunningServers);
  useEffect(() => {
    if (!window.commons) return;
    refreshServers();
    return window.commons.onDevServerStatus(refreshServers);
  }, []);
  // Duplicate-port awareness: servers for THIS project started outside
  // Commons (a terminal `pnpm dev`, a Claude Code session). Detected when
  // the menu opens; read-only — we never kill other tools' processes.
  const [externalServers, setExternalServers] = useState<{ port: number; pid: number }[]>([]);
  useEffect(() => {
    if (!switcherOpen || !repoPath || !window.commons?.detectExternalServers) return;
    void window.commons
      .detectExternalServers([repoPath])
      .then((found) => setExternalServers(found.map(({ port, pid }) => ({ port, pid }))))
      .catch(() => setExternalServers([]));
  }, [switcherOpen, repoPath]);
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

  // One side-panel slot: Agent and Narrate are exclusive — opening one
  // closes the other, and both slide in under their titlebar buttons.
  const [sidePanel, setSidePanel] = useState<"agents" | "narrate" | "inbox" | null>(null);
  // Approved annotations back the canvas Notes layer; drafts stay in the panel.
  const annotationData = useQuery(api.annotations.forProject, {
    projectId: nav.projectId,
    userId: me._id,
    sessionToken: sessionToken(),
  });
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
    () => registerShortcut("a", () => setSidePanel((p) => (p === "agents" ? null : "agents")), { description: "Agent sessions" }),
    []
  );
  useEffect(
    () => registerShortcut("n", () => setSidePanel((p) => (p === "narrate" ? null : "narrate")), { description: "Narrate (design notes)" }),
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
    setSidePanel("agents");
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

  const projectName = project?.name;
  useEffect(() => {
    if (!projectName) return;
    pushRecent(nav.projectId, projectName);
    onProjectName?.(nav.projectId, projectName);
    window.commons?.setMenuRecents(getRecents());
    // Window title carries the project, so the Window menu and Mission
    // Control show which Commons window is which.
    document.title = `${projectName} · Commons`;
    return () => {
      document.title = "Commons";
    };
  }, [nav.projectId, projectName]);

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
        window.commons.startDevServer(repoPath, project?.name).then((s) => !cancelled && setDevStatus(s));
      }
    });
    const unsubscribe = window.commons.onDevServerStatus((path, status) => {
      if (path === repoPath) setDevStatus(status);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      // Back to the dashboard (or a different project): free the port after
      // a grace window — fast return stays instant, idle servers die.
      void window.commons.releaseDevServer?.(repoPath).catch(() => {});
    };
  }, [repoPath]);

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
  const routeFrames = frames.filter((f) => f.kind === "route");
  // Mobile projects (phone-sized frames) default to the iPhone preset.
  const protoDevice =
    chosenDevice ??
    (routeFrames.length > 0 && routeFrames.every((f) => f.width <= 500) ? DEVICES[0] : DEVICES[3]);

  const mentionUsers =
    project.visibility === "private"
      ? users.filter((u) => u._id === project.createdBy || (project.memberIds ?? []).includes(u._id))
      : users;

  return (
    <div className="app">
      {/* Row 1 is app chrome, identical to home: tabs left, the global
          cluster right. Everything project-scoped lives on the subnav. */}
      <div className="titlebar">
        {tabStrip}
        <span className="spacer" />
        <button
          className="btn ghost icon-btn"
          aria-label="Search"
          title="Jump to project (⌘K)"
          onClick={() => window.dispatchEvent(new Event("commons:palette"))}
        >
          <Icon name="search" />
        </button>
        <ServersMenu />
        <WorkspacesMenu me={me} />
        <Team me={me} />
        <Inbox
          me={me}
          setNav={setNav}
          open={sidePanel === "inbox"}
          onOpenChange={(o) => setSidePanel(o ? "inbox" : null)}
        />
        <AccountMenu me={me} onSignOut={onSignOut} />
      </div>
      <div className="subnav">
        <div className="seg-wrap" ref={deviceMenuRef}>
          <div className="seg">
            <button
              className={nav.view === "canvas" ? "on" : ""}
              aria-label="Canvas"
              title="Canvas: every screen, comments, notes"
              onClick={() => {
                setDeviceMenuOpen(false);
                setNav({ ...nav, view: "canvas" });
              }}
            >
              <Icon name="frames" />
            </button>
            <button
              className={`${nav.view === "prototype" ? "on" : ""} ${deviceMenuOpen ? "menu-open" : ""}`}
              aria-label="Prototype"
              title={
                nav.view === "prototype"
                  ? `Prototype · ${protoDevice.label}. Click to pick a device`
                  : "Prototype: the running app, full size"
              }
              onClick={() => {
                if (nav.view === "prototype") setDeviceMenuOpen((o) => !o);
                else setNav({ ...nav, view: "prototype" });
              }}
            >
              <Icon name={nav.view === "prototype" ? protoDevice.icon : "play"} />
            </button>
          </div>
          {deviceMenuOpen && (
            <div className="device-menu">
              {DEVICES.filter((d) => d.label !== protoDevice.label).map((d) => (
                <button
                  key={d.label}
                  aria-label={d.label}
                  title={d.label}
                  onClick={() => {
                    setChosenDevice(d);
                    setDeviceMenuOpen(false);
                  }}
                >
                  <Icon name={d.icon} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="seg-wrap" ref={switcherRef}>
          {/* The active tab owns the project's name; this trigger is just the
              dev-server status and its menu. */}
          <button
            className="proj-switcher compact"
            aria-label={`${project.name}: server & project menu`}
            title={devStatus.state === "ready" ? `Dev server on :${devStatus.port}` : "Server & projects"}
            onClick={() => setSwitcherOpen((o) => !o)}
          >
            <span className={`status-dot ${repoPath ? devStatus.state : ""}`} />
            <Icon name="chevron" size={13} />
          </button>
          {switcherOpen && (
            <div className="titlebar-popover switcher-menu">
              {repoPath && (
                <div className="switcher-status">
                  <span className="hint">
                    {devStatus.state === "ready"
                      ? `dev · :${devStatus.port}`
                      : devStatus.state === "starting"
                        ? "starting…"
                        : devStatus.state === "error"
                          ? "dev server error"
                          : "stopped"}
                    {gitStatus &&
                      ` · ${gitStatus.branch}${gitStatus.behind > 0 ? ` ↓${gitStatus.behind}` : ""}${
                        gitStatus.ahead > 0 ? ` ↑${gitStatus.ahead}` : ""
                      }${gitStatus.dirty ? " •" : ""}`}
                  </span>
                  <span style={{ flex: 1 }} />
                  {devStatus.state === "ready" && (
                    <>
                      <button
                        className="btn ghost quiet-action"
                        title="Stop, then start fresh"
                        onClick={async () => {
                          await window.commons.stopDevServer(repoPath);
                          void window.commons.startDevServer(repoPath).then(setDevStatus);
                        }}
                      >
                        Restart
                      </button>
                      <button
                        className="btn ghost quiet-action"
                        title="Stop this dev server and free its port"
                        onClick={() => void window.commons.stopDevServer(repoPath)}
                      >
                        Stop
                      </button>
                    </>
                  )}
                  {(devStatus.state === "stopped" || devStatus.state === "error") && (
                    <button
                      className="btn ghost quiet-action"
                      title="Start the dev server"
                      onClick={() => void window.commons.startDevServer(repoPath).then(setDevStatus)}
                    >
                      {devStatus.state === "error" ? "Retry" : "Start"}
                    </button>
                  )}
                </div>
              )}
              {externalServers.map((ext) => (
                <div key={ext.pid + ":" + ext.port} className="switcher-status">
                  <span className="status-dot starting" />
                  <span
                    className="hint"
                    title={`Process ${ext.pid} is serving this project's folder — likely a terminal or coding agent. Stop it there to free the port.`}
                  >
                    also on :{ext.port} · outside Commons
                  </span>
                </div>
              ))}
              {(() => {
                const others = runningServers.filter(
                  (srv) => srv.repoPath !== repoPath && srv.status.state !== "stopped"
                );
                if (others.length === 0) return null;
                return (
                  <>
                    <PopSection label={`Also running · ${others.length}`} />
                    {others.map((srv) => (
                      <div key={srv.repoPath} className="switcher-status">
                        <span
                          className={`status-dot ${
                            srv.status.state === "ready"
                              ? "ready"
                              : srv.status.state === "starting"
                                ? "starting"
                                : "error"
                          }`}
                        />
                        <span className="hint" title={srv.repoPath}>
                          {srv.name ?? srv.repoPath.split("/").pop()}
                          {"port" in srv.status ? ` · :${srv.status.port}` : ""}
                        </span>
                        <span style={{ flex: 1 }} />
                        <button
                          className="btn ghost quiet-action"
                          title="Stop this dev server and free its port"
                          onClick={() => void window.commons.stopDevServer(srv.repoPath)}
                        >
                          Stop
                        </button>
                      </div>
                    ))}
                  </>
                );
              })()}
              {/* "All projects" left with the tabs: the home tab is the way
                  back now, so this menu is purely servers. */}
              {!repoPath && (
                <div className="switcher-status">
                  <span className="hint">No local repo connected</span>
                </div>
              )}
            </div>
          )}
        </div>
        {repoPath && (
          <>
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
        )}
        <SetupPopover
          project={project}
          repoPath={repoPath}
          cloning={cloning}
          onClone={() => void cloneProject()}
          onLocate={() => void locateRepo()}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
        <span className="tb-divider" />
        {(repoPath || project.gitRemote || convexSessions.length > 0) && (
          <button
            className={`btn ghost icon-btn ${sidePanel === "agents" ? "active" : ""}`}
            aria-label="Agent sessions"
            title="Agent sessions (A)"
            onClick={() => setSidePanel((p) => (p === "agents" ? null : "agents"))}
          >
            <Icon name="zap" />
            {runningCount > 0 && <span className="count-badge live">{runningCount}</span>}
          </button>
        )}
        <button
          className={`btn ghost icon-btn ${sidePanel === "narrate" ? "active" : ""}`}
          aria-label="Narrate"
          title="Narrate: design rationale annotations (N)"
          onClick={() => setSidePanel((p) => (p === "narrate" ? null : "narrate"))}
        >
          <Icon name="pen" />
          {(annotationData?.draftCount ?? 0) > 0 && (
            <span className="count-badge">{annotationData!.draftCount}</span>
          )}
        </button>
        <span className="tb-divider" />
        {/* Presence = teammates only; your own face is the account menu. */}
        <div className="avatar-stack">
          {activeUsers.map(
            (user) =>
              user &&
              user._id !== me._id && (
                <span key={user._id} className="avatar" style={{ background: user.avatarColor }} title={`${user.name} is here now`}>
                  {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}
                </span>
              )
          )}
        </div>
        <SharePopover project={project} me={me} users={users} nav={nav} />
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
          onSendToAgent={window.commons && (repoPath || project.gitRemote) ? sendThreadToAgent : undefined}
          onTidy={repoPath ? tidyCanvas : undefined}
          webLinkBase={
            project.shareToken
              ? `${(getConvexUrl() ?? "").replace(".convex.cloud", ".convex.site")}/p/${project.shareToken}`
              : undefined
          }
          heatmap={
            heatmapTestId && heatmapData
              ? { ...heatmapData, onClear: () => setHeatmapTestId(null) }
              : undefined
          }
          annotations={annotationData?.annotations
            .filter((a) => a.status === "approved")
            .map((a) => ({ _id: a._id, frameId: a.frameId, text: a.text, inferred: a.citations.length === 0 }))}
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
            window.commons && (repoPath || project.gitRemote)
              ? (title, prompt, routePath) => void startAgentSession({ title, prompt, routePath })
              : undefined
          }
          device={protoDevice}
        />
      )}

      {sidePanel === "narrate" && (
        <NarrationPanel
          me={me}
          project={project}
          frames={frames}
          threads={threads}
          repoPath={repoPath}
          onClose={() => setSidePanel(null)}
        />
      )}

      {sidePanel === "agents" && (
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
          onClose={() => setSidePanel(null)}
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
