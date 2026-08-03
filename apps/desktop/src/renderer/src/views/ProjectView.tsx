import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
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
import { getConvexUrl, initials, sessionToken, timeAgo } from "../lib/session";
import { usePublicSiteUrl } from "../lib/publicUrl";
import { resolveFrameUrl } from "../lib/frameUrl";
import { playConnected, playDraftReady, playProposals, playThrow } from "../lib/sounds";
import { claimSurface, useSurfaceExclusivity } from "../lib/surfaces";
import { registerShortcut } from "../lib/shortcuts";
import { layoutFrames } from "../lib/frameLayout";
import { flowPositions } from "../lib/flowLayout";
import { useClickOutside } from "../lib/useClickOutside";
import { useMachineId } from "../lib/machine";
import { getRecents, pushRecent } from "../lib/recents";
import Icon, { type IconName } from "../components/icons";
import CoverageLedger from "./CoverageLedger";
import { PopSection, RevealField } from "../components/popover";
import { ConnectionPanel } from "./ConnectionPanel";
import { PublishPanel } from "./PublishPanel";

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
type SettingKey = "repo" | "preview" | "drafts" | "history" | "figma" | "share";

/** One toolbar icon, one concern: a small anchored popover per setting. */
function SettingPopover({
  icon,
  label,
  attention,
  open,
  onOpenChange,
  children,
}: {
  icon: IconName;
  label: string;
  attention?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => onOpenChange(false), open);
  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className={`btn ghost icon-btn ${open ? "active" : ""}`}
        aria-label={label}
        title={label}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name={icon} />
        {attention && <span className="attention-dot" />}
      </button>
      {open && <div className="titlebar-popover setup-pop">{children}</div>}
    </div>
  );
}

/**
 * A dev server Commons didn't start, with the option to stop it.
 *
 * Stopping asks twice on purpose. This is someone else's process — a terminal
 * they alt-tabbed away from, an agent mid-run — and unlike stopping a server
 * Commons owns, there is nothing here that can bring it back. The main process
 * re-checks that this pid still serves this repo before signalling, so a pid
 * recycled between render and click can't take an unrelated process with it.
 */
function ExternalServerRow({
  server,
  repoPath,
  onStopped,
}: {
  server: { port: number; pid: number };
  repoPath?: string;
  onStopped: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = async () => {
    if (!repoPath || !window.commons?.stopExternalServer) return;
    setBusy(true);
    setError(null);
    const result = await window.commons.stopExternalServer(repoPath, server.port, server.pid);
    setBusy(false);
    if (result.ok || result.reason === "gone") {
      onStopped();
      return;
    }
    setConfirming(false);
    setError(
      result.reason === "no_permission"
        ? "That process belongs to another user — stop it where you started it."
        : "Couldn't stop it."
    );
  };

  return (
    <div className="switcher-status">
      <span className="status-dot starting" />
      <span
        className="hint"
        title={`Process ${server.pid} is serving this project's folder — likely a terminal or coding agent.`}
      >
        also on :{server.port} · outside Commons
      </span>
      <span style={{ flex: 1 }} />
      {error ? (
        <span className="hint">{error}</span>
      ) : confirming ? (
        <>
          <button className="btn ghost quiet-action" disabled={busy} onClick={() => void stop()}>
            {busy ? "Stopping…" : "Confirm stop"}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button
          className="btn ghost"
          title="Stop this process. Commons didn't start it, so it won't be able to restart it either."
          onClick={() => setConfirming(true)}
        >
          Stop
        </button>
      )}
    </div>
  );
}

/**
 * A URL-valued setting: first open shows the explainer and the field;
 * once set, shows the current value with Change/Remove.
 */
/**
 * Figma on the canvas (CAN-6): paste a frame link, get a frame. The token is
 * a workspace credential (one paste covers every project in it), and the
 * frame renders through the same snapshot path as everything else, so the
 * rest of the app never learns the word Figma.
 */
function FigmaSettingBody({ project, me }: { project: Doc<"projects">; me: Doc<"users"> }) {
  const figmaStatus = useQuery(api.figma.status, {
    projectId: project._id,
    userId: me._id,
    sessionToken: sessionToken(),
  });
  const saveToken = useMutation(api.figma.setToken);
  const addFrame = useMutation(api.figma.addFrame);
  const [token, setToken] = useState("");
  const [frameUrl, setFrameUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);

  // Every setting popover wraps its content in .reveal-form (which supplies
  // the popover's padding — .titlebar-popover has none) and leads with a
  // .reveal-label header. This body used to skip both, so the text jammed
  // flush against the popover edges with no title.
  if (!figmaStatus)
    return (
      <div className="reveal-form">
        <span className="reveal-label">Figma</span>
        <span className="hint">Loading…</span>
      </div>
    );
  if (!figmaStatus.workspaceId)
    return (
      <div className="reveal-form">
        <span className="reveal-label">Figma</span>
        <span className="hint">Figma frames need this project in a workspace.</span>
      </div>
    );

  if (!figmaStatus.connected) {
    return (
      <div className="reveal-form">
        <span className="reveal-label">Connect Figma</span>
        <span className="hint">An access token from Figma → Settings → Security. Read-only.</span>
        <div className="reveal-form-row">
          <input placeholder="figd_…" value={token} onChange={(e) => setToken(e.target.value)} />
          <button
            className="btn primary"
            disabled={!token.trim()}
            onClick={async () => {
              await saveToken({
                workspaceId: figmaStatus.workspaceId!,
                userId: me._id,
                sessionToken: sessionToken(),
                figmaToken: token.trim(),
              });
              playConnected();
              setToken("");
            }}
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reveal-form">
      <span className="reveal-label">Figma</span>
      <span className="hint">Paste a frame link to add it to the canvas.</span>
      <div className="reveal-form-row">
        <input
          placeholder="figma.com/design/…?node-id=…"
          value={frameUrl}
          onChange={(e) => setFrameUrl(e.target.value)}
        />
        <button
          className="btn primary"
          disabled={!frameUrl.trim()}
          onClick={async () => {
            setNote(null);
            try {
              await addFrame({
                projectId: project._id,
                userId: me._id,
                sessionToken: sessionToken(),
                figmaUrl: frameUrl.trim(),
              });
              setFrameUrl("");
              setNote("Frame added — the render arrives in a few seconds.");
            } catch (err) {
              setNote(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Add frame
        </button>
      </div>
      {note && <span className="hint">{note}</span>}
    </div>
  );
}

/**
 * Review the browser crawl's proposed states (Flow v2). Each is a real
 * screenshot of a really-reached state; approving promotes it to a state frame
 * on the flow graph with an edge from its origin route, rejecting frees the
 * blob. Nothing the crawl found reaches the graph without passing through here.
 */
function FlowReviewPanel({
  proposals,
  me,
  onClose,
}: {
  proposals: {
    _id: string;
    routePath: string;
    stateLabel: string;
    trigger: string | null;
    fromRoutePath: string | null;
    imageUrl: string | null;
  }[];
  me: Doc<"users">;
  onClose: () => void;
}) {
  const promote = useMutation(api.flows.promoteProposal);
  const reject = useMutation(api.flows.rejectProposal);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay-scrim" onMouseDown={onClose}>
      <div className="overlay-card flow-review" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <span>Edge cases found</span>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="flow-review-body">
          {note && <span className="form-error">{note}</span>}
          {proposals.length === 0 && (
            <p className="hint">Nothing pending. Run “Find error &amp; empty states” to send a browser through your preview.</p>
          )}
          {proposals.map((p) => (
            <div key={p._id} className="flow-proposal">
              {p.imageUrl && <img src={p.imageUrl} alt={p.stateLabel} />}
              <div className="flow-proposal-meta">
                <div className="flow-proposal-title">{p.stateLabel}</div>
                <div className="hint">
                  {p.routePath}
                  {p.trigger ? ` · ${p.trigger}` : ""}
                </div>
                <div className="flow-proposal-actions">
                  <button
                    className="btn"
                    onClick={async () => {
                      setNote(null);
                      try {
                        await promote({
                          proposalId: p._id as Id<"flowStateProposals">,
                          userId: me._id,
                          sessionToken: sessionToken(),
                        });
                      } catch (err) {
                        setNote(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    Add
                  </button>
                  <button
                    className="btn ghost danger"
                    onClick={async () => {
                      setNote(null);
                      try {
                        await reject({
                          proposalId: p._id as Id<"flowStateProposals">,
                          userId: me._id,
                          sessionToken: sessionToken(),
                        });
                      } catch (err) {
                        setNote(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The deploy log as a version history. On hosts with immutable per-deploy
 * URLs every row is an openable old version of the app, so each entry is a
 * link, not a line item. previewUrl says "now"; this is "and before that".
 */
function DeployHistoryBody({ projectId, me }: { projectId: Id<"projects">; me: Doc<"users"> }) {
  const history = useQuery(api.github.deployHistory, {
    projectId,
    userId: me._id,
    sessionToken: sessionToken(),
  });
  if (!history || history.length === 0) {
    return (
      <div className="reveal-form">
        <span className="reveal-label">History</span>
        <span className="hint">Deploys land here once GitHub is connected.</span>
      </div>
    );
  }
  return (
    <div className="reveal-form">
      <span className="reveal-label">History</span>
      <div className="deploy-history">
      {history.map((d) => (
        <button
          key={d._id}
          className="deploy-row"
          title="Open this version in your browser"
          onClick={() => (window.commons ? void window.commons.openExternal(d.url) : window.open(d.url))}
        >
          <span className={`deploy-dot ${d.production ? "prod" : ""}`} />
          <span className="deploy-when">{timeAgo(d.at)}</span>
          <span className="deploy-branch" title={d.branch}>
            {d.branch}
          </span>
          {d.sha && <span className="deploy-sha">{d.sha}</span>}
          {d.current && <span className="deploy-current">current</span>}
        </button>
        ))}
      </div>
    </div>
  );
}

function UrlSettingBody({
  label,
  hint,
  placeholder,
  value,
  learned,
  learnedAt,
  connection,
  onDiagnose,
  onSignIn,
  onReplayDeploys,
  validate,
  onSave,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value?: string | null;
  /** True when Commons worked this value out from a GitHub deploy, not a person. */
  learned?: boolean;
  learnedAt?: number;
  /** Why this field is still empty, when GitHub was supposed to fill it. */
  connection?: string | null;
  /** Opens the full diagnosis, for when the one-line note isn't the answer. */
  onDiagnose?: () => void;
  /** Opens the app full-size so a person can sign in once for every frame. */
  onSignIn?: () => void;
  /** Connected-but-quiet: ask GitHub to re-send its recent deploy events. */
  onReplayDeploys?: () => Promise<number>;
  validate: (v: string) => string | null;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const showField = editing || !value;
  const connectionNote = connection ? <span className="hint">{connection}</span> : null;
  /* Offered whenever GitHub is meant to be filling this in, not only when we
     already know something is wrong — "it says connected and still nothing
     happens" is exactly the case the one-line note cannot cover. */
  const diagnoseLink = onDiagnose ? (
    <button className="btn ghost diagnose-link" onClick={onDiagnose}>
      Check connection…
    </button>
  ) : null;
  /**
   * Screens behind a login all render the login screen, which reads as a
   * broken canvas rather than a working app doing what it should. Every frame
   * and the prototype share one browser session, so signing in once anywhere
   * fixes all of them — but nothing said so, and there was no path to it.
   */
  const [replayNote, setReplayNote] = useState<string | null>(null);
  const replayLink = onReplayDeploys ? (
    <button
      className="btn ghost diagnose-link"
      onClick={async () => {
        setReplayNote("Asking GitHub…");
        const n = await onReplayDeploys().catch(() => 0);
        setReplayNote(n > 0 ? `Replaying ${n} past deploy${n === 1 ? "" : "s"} — give it a moment.` : "GitHub had nothing recent to replay — deploy once and it fills in.");
      }}
    >
      Replay past deploys
    </button>
  ) : null;
  const signInLink = onSignIn ? (
    <button className="btn ghost diagnose-link" onClick={onSignIn}>
      Sign in to previews…
    </button>
  ) : null;

  const save = async (next: string) => {
    const problem = next ? validate(next) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reveal-form">
      <span className="reveal-label">{label}</span>
      {showField ? (
        <>
          <span className="hint">{hint}</span>
          {connectionNote}
          {(replayLink || signInLink) && (
            <div className="reveal-form-row">
              {replayLink}
              {signInLink}
            </div>
          )}
          {replayNote && <span className="hint">{replayNote}</span>}
          {error && <span className="form-error">{error}</span>}
          <div className="reveal-form-row">
            <input
              autoFocus
              value={draft}
              placeholder={placeholder}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save(draft.trim());
                if (e.key === "Escape" && value) {
                  setEditing(false);
                  setDraft(value);
                }
              }}
            />
            <button className="btn primary" disabled={busy || !draft.trim()} onClick={() => void save(draft.trim())}>
              Save
            </button>
            {value && (
              <button
                className="btn ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(value);
                  setError(null);
                }}
              >
                ✕
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {/* The value is the point of this popover, so it acts like one: open
              it to check it is really the right build, copy it to paste
              somewhere. Reading a truncated URL and retyping it was the only
              thing on offer before. */}
          <button
            className="setting-value linked"
            title={`${value}\n\nOpens in your browser`}
            onClick={() => value && (window.commons ? void window.commons.openExternal(value) : window.open(value))}
          >
            {value}
          </button>
          {learned && (
            <span className="hint">
              From your last deploy{learnedAt ? ` ${timeAgo(learnedAt)} ago` : ""}. Type your own to pin it.
            </span>
          )}
          {error && <span className="form-error">{error}</span>}
          <div className="reveal-form-row">
            <button
              className="btn ghost"
              title="Copy to the clipboard"
              onClick={() => {
                if (!value) return;
                void navigator.clipboard.writeText(value);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setDraft(value ?? "");
                setError(null);
                setEditing(true);
              }}
            >
              Change…
            </button>
            {diagnoseLink}
            {replayLink}
            {signInLink}
            <button className="btn ghost quiet-action" disabled={busy} onClick={() => void save("")}>
              Remove
            </button>
          </div>
          {replayNote && <span className="hint">{replayNote}</span>}
        </>
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
  open,
  onOpenChange,
}: {
  project: Doc<"projects">;
  me: Doc<"users">;
  users: Doc<"users">[];
  nav: Extract<Nav, { screen: "project" }>;
  /** Controlled by ProjectView so it shares the one-surface-at-a-time slot. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
  const setVisibility = useMutation(api.projects.setVisibility);
  const setMembers = useMutation(api.projects.setMembers);
  const moveProject = useMutation(api.workspaces.moveProject);
  const setShareToken = useMutation(api.projects.setShareToken);
  const [copied, setCopied] = useState<"app" | "web" | null>(null);
  const invite = useMutation(api.invites.create);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteNote, setInviteNote] = useState<string | null>(null);
  const sendInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    const result = await invite({
      email,
      invitedBy: me._id,
      projectId: project._id,
      sessionToken: sessionToken(),
    }).catch(() => ({ ok: false as const, reason: "invalid_email" as const }));
    if (result.ok) {
      setInviteNote(`Invited — the email links straight to ${project.name}.`);
      setInviteEmail("");
    } else {
      setInviteNote(
        result.reason === "already_member"
          ? "They already have an account — @mention them instead."
          : result.reason === "already_invited"
            ? "Already invited. The email is on its way."
            : "That doesn't look like an email address."
      );
    }
  };
  const isCreator = project.createdBy === me._id;
  const myWorkspaces = useQuery(
    api.workspaces.mine,
    open && isCreator ? { userId: me._id, sessionToken: sessionToken() } : "skip"
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);
  const publicSite = usePublicSiteUrl();
  const shareUrl = project.shareToken ? `${publicSite}/g/${project.shareToken}` : null;

  const copy = (kind: "app" | "web", text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  const memberIds = project.memberIds ?? [];
  const isPrivate = project.visibility === "private";
  const toggleMember = (userId: Id<"users">) => {
    const next = memberIds.includes(userId) ? memberIds.filter((id) => id !== userId) : [...memberIds, userId];
    void setMembers({ projectId: project._id, userId: me._id, sessionToken: sessionToken(), memberIds: next });
  };

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className={`btn ghost icon-btn ${open ? "active" : ""}`}
        aria-label="Share"
        title={isPrivate ? "Private — only you and added members" : "Share this project"}
        onClick={() => setOpen(!open)}
      >
        <Icon name="share" />
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
          <PopSection label="Invite" />
          <div className="reveal-form" style={{ paddingTop: 0 }}>
            {/* ID-11: an invite sent from here carries this project — the
                email deep-links into this canvas and acceptance lands in its
                workspace, so "come see this" is one send, not a tour. */}
            <div className="reveal-form-row">
              <input
                placeholder="teammate@company.com"
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value);
                  setInviteNote(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendInvite();
                }}
              />
              <button className="btn" disabled={!inviteEmail.trim()} onClick={() => void sendInvite()}>
                Invite
              </button>
            </div>
            {inviteNote && <span className="hint">{inviteNote}</span>}
          </div>
          {isCreator && (
            <>
              <PopSection label="Access" />
              <div style={{ padding: "0 14px 10px" }}>
                <div className="seg" style={{ display: "flex", marginBottom: 8 }}>
                  <button
                    className={!isPrivate ? "on" : ""}
                    style={{ flex: 1 }}
                    onClick={() => setVisibility({ projectId: project._id, userId: me._id, sessionToken: sessionToken(), visibility: "team" })}
                  >
                    Team
                  </button>
                  <button
                    className={isPrivate ? "on" : ""}
                    style={{ flex: 1 }}
                    onClick={() => setVisibility({ projectId: project._id, userId: me._id, sessionToken: sessionToken(), visibility: "private" })}
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
  // Branded origin for anything a teammate or stakeholder will actually open.
  const publicSite = usePublicSiteUrl();
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
  const setPreviewUrl = useMutation(api.projects.setPreviewUrl);

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
        await linkRepo({ projectId: nav.projectId, userId: me._id, repoPath: repoLink.repoPath, machineId, sessionToken: sessionToken() });
      } catch {
        // Path isn't on this machine — leave the legacy row for its owner.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoLinkIsLegacy, machineId]);
  // Which teammates have live frames — drives viewer empty states.
  const repoHolders = useQuery(api.repoLinks.holders, { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() }) ?? [];
  const holderNames = repoHolders.filter((h) => h.userId !== me._id).map((h) => h.name);
  // You hold this repo — on some other machine. Empty states say so.
  const selfHasRepoElsewhere = repoHolders.some((h) => h.userId === me._id);

  const [devStatus, setDevStatus] = useState<DevServerStatus>({ state: "stopped" });
  /**
   * A dev server belongs to a repo. Without a working copy on this machine
   * there is no live server for *this* project, whatever devStatus happens to
   * hold — so everything that resolves a frame URL reads this, not devStatus
   * directly. The effect below also clears on project change; this makes the
   * wrong-project case unrepresentable rather than merely handled.
   */
  const liveStatus: DevServerStatus = repoPath ? devStatus : { state: "stopped" };
  /**
   * Is there a running app to sign in to at all? Frames, the prototype and
   * this all resolve through the same function, so the sign-in path is offered
   * exactly when the canvas has something to show — dev server or deployed
   * preview, whichever the frames are already using.
   */
  const signInTarget = resolveFrameUrl("/", liveStatus, project?.previewUrl) !== null;
  const [openSetting, setOpenSettingRaw] = useState<SettingKey | null>(null);
  /**
   * Freshness marker: everything Convex-backed is live, so the only thing
   * that can go stale mid-session is the pixels inside the frames. The
   * webhook stamps lastDeployAt the moment a deploy goes green and that
   * field streams into this view, so "is there a newer version" is a
   * comparison, not a poll: newer than when you opened it means the iframes
   * predate the deploy.
   */
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  useEffect(() => setOpenedAt(Date.now()), [nav.projectId]);
  // The Tests panel points here instead of embedding its own editor.
  useEffect(() => {
    const onOpen = () => setOpenSetting("preview");
    window.addEventListener("commons:open-preview-setting", onOpen);
    return () => window.removeEventListener("commons:open-preview-setting", onOpen);
  }, []);
  // Prototype device, owned here because the titlebar's split view switcher
  // selects it: the Prototype segment shows the current device's icon and,
  // when already active, opens a small menu of the presets.
  const [chosenDevice, setChosenDevice] = useState<ProtoDevice | null>(null);
  const [deviceMenuOpen, setDeviceMenuOpenRaw] = useState(false);
  const setDeviceMenuOpen = (open: boolean) => {
    setDeviceMenuOpenRaw(open);
    if (open) {
      setOpenSettingRaw(null);
      setSidePanelRaw(null);
    }
  };
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
  // Commons (a terminal `pnpm dev`, a Claude Code session). Detected when the
  // menu opens. Stopping one is possible, but only as a deliberate, confirmed
  // act — Commons never reaps another tool's process on its own.
  const [externalServers, setExternalServers] = useState<{ port: number; pid: number }[]>([]);
  useEffect(() => {
    if (!switcherOpen || !repoPath || !window.commons?.detectExternalServers) return;
    void window.commons
      .detectExternalServers([repoPath])
      .then((found) => setExternalServers(found.map(({ port, pid }) => ({ port, pid }))))
      .catch(() => setExternalServers([]));
  }, [switcherOpen, repoPath]);
  const [cloning, setCloning] = useState(false);

  // If the repo deploys on Vercel, use its project name to make the empty
  // draft-previews field self-explanatory. A hint for the placeholder only —
  // the team slug isn't knowable locally, so nothing is ever filled in for you.
  /**
   * "Connected but nothing has deployed" and "never connected" used to look
   * identical: an empty field. Naming which one you're in is the difference
   * between a five-second answer and an afternoon.
   */
  const githubStatus = useQuery(api.github.projectStatus, {
    projectId: nav.projectId,
    userId: me._id,
    sessionToken: sessionToken(),
  });
  const [connectionOpen, setConnectionOpen] = useState(false);
  // Shown after "Sign in to previews…" sends someone to the full-size app.
  const [signInHint, setSignInHint] = useState(false);
  // Flow view: edges from recorded tester navigation; positions computed as
  // a layered left-to-right graph. Only queried while the view is open.
  // State frames (Flow v2) live only in the flow view; keep them off the
  // canvas and prototype so those stay the app's real routes.
  const canvasFrames = useMemo(() => frames.filter((f) => f.kind !== "state"), [frames]);
  const flowProposals = useQuery(
    api.flows.proposals,
    nav.view === "flow" ? { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() } : "skip"
  );
  const crawl = useQuery(
    api.flows.crawlStatus,
    nav.view === "flow" ? { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() } : "skip"
  );
  const startCrawl = useMutation(api.flows.startCrawl);
  const addFlowEdge = useMutation(api.flows.addEdge);
  const [crawlNote, setCrawlNote] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string>("");
  const [connectTo, setConnectTo] = useState<string>("");
  const [connectLabel, setConnectLabel] = useState("");
  const flowEdges = useQuery(
    api.flows.edges,
    nav.view === "flow" ? { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() } : "skip"
  );
  // Crawl findings arriving is news; reviewing them is a choice. First sight
  // of a bigger pending queue knocks, once.
  const prevProposalCount = useRef(0);
  useEffect(() => {
    const pending = (flowProposals ?? []).length;
    if (pending > prevProposalCount.current && prevProposalCount.current >= 0 && nav.view === "flow") playProposals();
    prevProposalCount.current = pending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowProposals?.length]);

  const deriveFlow = useMutation(api.flows.deriveFromTests);
  const [deriving, setDeriving] = useState(false);

  // ── Exploration layer ────────────────────────────────────────────────────
  // Stamps and dots: one-click judgment on any frame. Queried only on the
  // canvas (guests and flow view do their own thing).
  const reactionsByFrame =
    useQuery(
      api.reactions.forProject,
      nav.view === "canvas" ? { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() } : "skip"
    ) ?? {};
  const votesData = useQuery(
    api.reactions.votesForProject,
    nav.view === "canvas" ? { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() } : "skip"
  );
  const toggleReaction = useMutation(api.reactions.toggle);
  const toggleVote = useMutation(api.reactions.toggleVote);
  const gifsByFrame =
    useQuery(
      api.reactions.gifsForProject,
      nav.view === "canvas" ? { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() } : "skip"
    ) ?? {};
  const addGifMutation = useMutation(api.reactions.addGif);
  const removeGif = useMutation(api.reactions.removeGif);
  const curateAnnotation = useMutation(api.annotations.curate);
  const setSupportsDarkMode = useMutation(api.projects.setSupportsDarkMode);
  const replayDeploysAction = useAction(api.githubApp.replayDeploys);
  const [gifFor, setGifFor] = useState<Doc<"frames"> | null>(null);
  const [gifAnchor, setGifAnchor] = useState<{ fx: number; fy: number } | null>(null);
  const giphy = useQuery(
    api.reactions.giphyKeyFor,
    gifFor ? { projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() } : "skip"
  );
  const setGiphyKey = useMutation(api.reactions.setGiphyKey);
  const [giphyResults, setGiphyResults] = useState<{ url: string; preview: string }[]>([]);
  const searchGiphy = async (q: string) => {
    if (!giphy?.key || !q.trim()) return;
    try {
      const res = await fetch(
        `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(giphy.key)}&q=${encodeURIComponent(q)}&limit=8&rating=pg-13`
      );
      const body = (await res.json()) as { data?: { images?: { fixed_height?: { url?: string }; fixed_height_small?: { url?: string } } }[] };
      setGiphyResults(
        (body.data ?? [])
          .map((g) => ({
            url: g.images?.fixed_height?.url ?? "",
            preview: g.images?.fixed_height_small?.url ?? g.images?.fixed_height?.url ?? "",
          }))
          .filter((g) => g.url)
      );
    } catch {
      setGifNote("Giphy didn't answer — check the key or the network.");
    }
  };
  /** A pasted or dropped image file becomes an uploaded sticker. */
  const uploadGifFile = async (file: File) => {
    if (!gifFor) return;
    if (!/image\/(gif|webp)/.test(file.type)) {
      setGifNote("Stickers move — paste or drop a GIF or animated WebP.");
      return;
    }
    const url = await generateUploadUrl({ userId: me._id, sessionToken: sessionToken() });
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    const result = await addGifMutation({
      frameId: gifFor._id,
      storageId,
      fx: gifAnchor?.fx,
      fy: gifAnchor?.fy,
      userId: me._id,
      sessionToken: sessionToken(),
    }).catch(() => ({ ok: false as const, reason: "not_a_gif" as const }));
    if (result.ok) {
      playThrow();
      setGifFor(null);
      setGiphyResults([]);
    } else {
      setGifNote(result.reason === "frame_full" ? "This screen already wears eight stickers." : "That upload didn't take.");
    }
  };
  /** The reaction palette, bloomed at the cursor by a right-click on a frame. */
  const [bloom, setBloomRaw] = useState<{ frame: Doc<"frames">; x: number; y: number; fx: number; fy: number } | null>(null);
  /**
   * The bloom is a hidden gesture, and hidden gestures need one honest
   * introduction: a line that lives until the first successful right-click
   * (or a dismissal), then never returns. The author asked where the emojis
   * went the morning after approving the design — that is the whole case.
   */
  const [bloomHintDismissed, setBloomHintDismissed] = useState(
    () => localStorage.getItem("commons.bloomHintSeen") === "yes"
  );
  const setBloom: typeof setBloomRaw = (next) => {
    if (next && !bloomHintDismissed) {
      localStorage.setItem("commons.bloomHintSeen", "yes");
      setBloomHintDismissed(true);
    }
    setBloomRaw(next);
  };
  const [gifUrl, setGifUrl] = useState("");
  const [gifNote, setGifNote] = useState<string | null>(null);
  const submitGif = async () => {
    if (!gifFor) return;
    const url = gifUrl.trim();
    if (!url) return;
    const result = await addGifMutation({
      frameId: gifFor._id,
      url,
      fx: gifAnchor?.fx,
      fy: gifAnchor?.fy,
      userId: me._id,
      sessionToken: sessionToken(),
    }).catch(() => ({ ok: false as const, reason: "not_a_gif" as const }));
    if (result.ok) {
      playThrow();
      setGifFor(null);
      setGifUrl("");
      setGifNote(null);
      setGiphyResults([]);
    } else {
      setGifNote(
        result.reason === "frame_full"
          ? "This screen already wears eight stickers — someone has to take one back first."
          : "That link isn't a GIF. In Giphy: Share → Copy GIF Link."
      );
    }
  };

  // What-if variants: a prompt on a frame becomes an agent draft, and the
  // draft becomes a sibling frame rendering the branch preview. The request
  // map remembers which session belongs to which frame so the result handler
  // can finish the story; the branch is knowable up front for local drafts
  // (we mint the slug) and read from the mirror for cloud ones.
  const addVariant = useMutation(api.projects.addVariant);
  const [whatIf, setWhatIf] = useState<{ frame: Doc<"frames"> } | null>(null);
  const [whatIfPrompt, setWhatIfPrompt] = useState("");
  const variantRequests = useRef(new Map<string, { frameId: Id<"frames">; prompt: string; branch?: string }>());
  // CAN-11: opening the Flow view on a machine with the repo refreshes the
  // code-declared edges — Link hrefs and router.push targets, drawn as quiet
  // dashed lines under whatever testers have actually walked. Re-scanned per
  // open, replaced wholesale (the code is the source of truth), and skipped
  // entirely without a working copy: no repo, no claims about the code.
  const ingestCodeEdges = useMutation(api.flows.ingestCodeEdges);
  const codeEdgesScanned = useRef<string | null>(null);
  useEffect(() => {
    if (nav.view !== "flow" || !repoPath || !window.commons?.discoverRouteLinks) return;
    if (codeEdgesScanned.current === repoPath) return;
    codeEdgesScanned.current = repoPath;
    void window.commons
      .discoverRouteLinks(repoPath)
      .then((links) =>
        ingestCodeEdges({ projectId: nav.projectId, links, userId: me._id, sessionToken: sessionToken() })
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.view, repoPath]);
  const flowPos = useMemo(
    () =>
      nav.view === "flow" && flowEdges
        ? flowPositions(
            frames.map((f) => ({ id: f._id, width: f.width, height: f.height, routePath: f.routePath ?? undefined })),
            flowEdges
          )
        : undefined,
    [nav.view, flowEdges, frames]
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const previewConnectionNote = (() => {
    if (!githubStatus) return null;
    if (githubStatus.accounts.length === 0) {
      return "Connect GitHub and deploys fill this in.";
    }
    // The specific silence, not the general one: a repo outside the
    // installation looks identical to one that has never deployed.
    if (githubStatus.repoCovered === false) {
      return `${githubStatus.accounts.join(", ")} connected, but this repo isn't in the installation. Add it under Configure.`;
    }
    if (!githubStatus.seenDeploy) {
      return `${githubStatus.accounts.join(", ")} connected — no deploy seen yet.`;
    }
    return null;
  })();

  // Which app in a monorepo a project points at is decided once, when the
  // project is created (see AppChoice). An open project deliberately has no
  // switcher: repointing live code swapped one app's screens for another's
  // and left frames from both drawn over each other. One repo, many apps
  // means many projects.

  const [vercelProject, setVercelProject] = useState<string | null>(null);
  useEffect(() => {
    if (!repoPath || !window.commons?.inspectRepo) return;
    let cancelled = false;
    void window.commons
      .inspectRepo(repoPath)
      .then((inspection) => {
        if (cancelled) return;
        setVercelProject(inspection.vercel?.projectName ?? null);
        // Self-heal: capability learned from the working copy, recorded so
        // every machine (and the theme flip's visibility) agrees.
        if (
          inspection.supportsDarkMode !== undefined &&
          project &&
          inspection.supportsDarkMode !== project.supportsDarkMode
        ) {
          void setSupportsDarkMode({
            projectId: nav.projectId,
            supportsDarkMode: inspection.supportsDarkMode,
            userId: me._id,
            sessionToken: sessionToken(),
          }).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

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
        await linkRepo({ projectId: nav.projectId, userId: me._id, repoPath: result.repoPath, machineId: machineId ?? undefined, sessionToken: sessionToken() });
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
  const [sidePanel, setSidePanelRaw] = useState<"agents" | "narrate" | "inbox" | "coverage" | null>(null);
  type SidePanel = "agents" | "narrate" | "inbox" | "coverage";
  // One surface at a time. Popovers, side panels and the device menu each used
  // to own their state and knew nothing of the others, so a popover could open
  // on top of a live panel. Every opener now goes through these, which close
  // whatever else is showing. Refs so the shortcut handlers, registered once,
  // can still read current values without a stale closure.
  const sidePanelRef = useRef<SidePanel | null>(sidePanel);
  sidePanelRef.current = sidePanel;
  const openSettingRef = useRef<SettingKey | null>(openSetting);
  openSettingRef.current = openSetting;
  const setOpenSetting = (key: SettingKey | null) => {
    setOpenSettingRaw(key);
    if (key) {
      setSidePanelRaw(null);
      setDeviceMenuOpen(false);
      // Also silence the global titlebar menus (inbox, team, …): the
      // one-surface rule holds across ownership boundaries, not just within
      // this component's own popovers.
      claimSurface("project-setting");
    }
  };
  const setSidePanel = (panel: SidePanel | null) => {
    setSidePanelRaw(panel);
    if (panel) {
      setOpenSettingRaw(null);
      setDeviceMenuOpen(false);
      claimSurface("project-panel");
    }
  };
  // And the mirror: a global menu opening closes this component's surfaces.
  useSurfaceExclusivity("project-setting", openSetting !== null, () => setOpenSettingRaw(null));
  useSurfaceExclusivity("project-panel", sidePanel !== null, () => setSidePanelRaw(null));
  const toggleSidePanel = (panel: SidePanel) =>
    setSidePanel(sidePanelRef.current === panel ? null : panel);
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
  const reloadFrames = () => {
    setFrameReloadTokens((prev) => {
      const next = { ...prev };
      for (const f of frames) next[f._id] = (next[f._id] ?? 0) + 1;
      return next;
    });
    setOpenedAt(Date.now());
  };
  const reloadRef = useRef(reloadFrames);
  reloadRef.current = reloadFrames;
  useEffect(
    () => registerShortcut("r", () => reloadRef.current(), { description: "Reload frames with the latest deploy" }),
    []
  );

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
        const url = resolveFrameUrl(frame.routePath, liveStatus, null)?.url;
        if (!url) continue;
        try {
          const png = await window.commons.captureSnapshot(url, { width: frame.width, height: frame.height });
          if (!png) continue;
          const uploadUrl = await generateUploadUrl({ userId: me._id, sessionToken: sessionToken() });
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

  // Phase 2: a deploy landed, so the canvas is showing pictures of the old
  // build. Recapture from the deployed preview URL — unlike the effect above,
  // this needs no local dev server, which is the whole point: the person who
  // notices the change first is rarely the person running the app.
  const claimSnapshotRefresh = useMutation(api.projects.claimSnapshotRefresh);
  useEffect(() => {
    if (!project?.snapshotsStaleAt || !window.commons?.captureSnapshot) return;
    void (async () => {
      // Whoever gets here first takes the job; the rest bail.
      const claim = await claimSnapshotRefresh({
        projectId: project._id,
        userId: me._id,
        sessionToken: sessionToken(),
      });
      if (!claim.claimed) return;
      const base = claim.previewUrl.replace(/\/+$/, "");
      for (const frame of frames.filter((f) => f.kind === "route")) {
        try {
          const png = await window.commons.captureSnapshot(`${base}${frame.routePath ?? "/"}`, {
            width: frame.width,
            height: frame.height,
          });
          if (!png) continue;
          const uploadUrl = await generateUploadUrl({ userId: me._id, sessionToken: sessionToken() });
          const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": "image/png" },
            body: new Blob([png as BlobPart], { type: "image/png" }),
          });
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
          await saveFrameSnapshot({ frameId: frame._id, storageId, userId: me._id, sessionToken: sessionToken() });
        } catch (err) {
          console.warn("post-deploy snapshot failed", frame.title, err);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.snapshotsStaleAt]);

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
    const beforeUrl = resolveFrameUrl(routePath, liveStatus, project?.previewUrl)?.url;
    if (!beforeUrl) return;

    const upload = async (png: Uint8Array) => {
      const url = await generateUploadUrl({ userId: me._id, sessionToken: sessionToken() });
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
    () => registerShortcut("a", () => toggleSidePanel("agents"), { description: "Agent sessions" }),
    []
  );
  useEffect(
    () => registerShortcut("g", () => toggleSidePanel("coverage"), { description: "Coverage: gaps and the runtime survey" }),
    []
  );
  useEffect(
    () => registerShortcut("n", () => toggleSidePanel("narrate"), { description: "Narrate (design notes)" }),
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
    /** Explicit branch slug (what-if variants need to know it up front). */
    draftSlug?: string;
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
            draftSlug: opts.draftSlug ?? slugify(opts.title),
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
    return mirrorId;
    setSidePanel("agents");
  };

  /**
   * Hand a conflicted draft back to the agent instead of to a person.
   *
   * The alternative is a merge UI, which the guardrails rule out and which
   * would be useless to the audience anyway: someone who reviews screens is
   * not going to resolve a three-way diff. The agent already knows why it
   * made these changes, which makes it better placed to redo them on top of
   * the moved base than anyone reading conflict markers cold.
   *
   * Stays on the Commons-owned branch, so nothing here touches the base.
   */
  const reconcileDraft = async (branch: string, baseBranch: string, conflicts: string[]) => {
    await startAgentSession({
      title: `Reconcile ${branch}`,
      prompt: [
        `The branch "${branch}" no longer merges cleanly into "${baseBranch}" — "${baseBranch}" has moved since this work started.`,
        "",
        `Conflicting files: ${conflicts.join(", ")}`,
        "",
        `Rebase "${branch}" onto the latest "${baseBranch}" and resolve every conflict, preserving the intent of the changes on this branch rather than discarding them for whatever is on ${baseBranch}. Where the two genuinely disagree, keep this branch's behaviour and adapt it to the new surroundings.`,
        "",
        `Stay on "${branch}". Do not merge, rebase, or push anything to "${baseBranch}". When you are done, summarize in one or two sentences what conflicted and how you resolved it.`,
      ].join("\n"),
    });
  };

  const dispatchCloudAgent = useMutation(api.cloudAgents.dispatch);

  /**
   * Cloud sessions (AG-10): same thread-to-prompt assembly, but execution is
   * a GitHub Actions run dispatched by the backend instead of this machine.
   * The session mirrors into the same tables, so the panel transcript below
   * is already watching it the moment it exists.
   */
  const startCloudSession = async (opts: {
    title: string;
    prompt: string;
    threadId?: Id<"threads">;
    frameId?: Id<"frames">;
    routePath?: string;
  }) => {
    const { sessionId } = await dispatchCloudAgent({
      projectId: nav.projectId,
      userId: me._id,
      sessionToken: sessionToken(),
      title: opts.title,
      prompt: opts.prompt,
      threadId: opts.threadId,
      frameId: opts.frameId,
      routePath: opts.routePath,
    });
    setActiveAgentSessionId(sessionId as Id<"agentSessions">);
    setSidePanel("agents");
    return sessionId as Id<"agentSessions">;
  };

  /**
   * The what-if gesture: a frame plus one sentence becomes an agent draft on
   * its own branch, and when the draft reports back, a sibling frame appears
   * rendering that branch's preview. PMs without a repo ride the cloud path;
   * the variant only needs the pattern to resolve, not this machine.
   */
  const fireWhatIf = async () => {
    const frame = whatIf?.frame;
    const prompt = whatIfPrompt.trim();
    if (!frame || !prompt) return;
    setWhatIf(null);
    setWhatIfPrompt("");
    const slug = `whatif-${slugify(prompt).slice(0, 32)}-${Math.floor(Math.random() * 900 + 100)}`;
    const title = `What if: ${prompt.length > 40 ? prompt.slice(0, 37) + "…" : prompt}`;
    const agentPrompt = [
      `You are exploring a what-if variant of one screen. Route: ${frame.routePath ?? "/"} ("${frame.title}").`,
      `The what-if: ${prompt}`,
      `Keep the change scoped to this screen and its immediate components. This is an exploration, not a refactor — favor the smallest change that makes the idea visible.`,
    ].join("\n\n");
    const opts = { title, prompt: agentPrompt, frameId: frame._id, routePath: frame.routePath };
    if (window.commons && (repoPath || project?.gitRemote)) {
      const sessionId = await startAgentSession({ ...opts, draftSlug: slug });
      if (sessionId) variantRequests.current.set(sessionId, { frameId: frame._id, prompt, branch: `commons/${slug}` });
    } else {
      const sessionId = await startCloudSession(opts);
      if (sessionId) variantRequests.current.set(sessionId, { frameId: frame._id, prompt });
    }
  };

  const sendThreadToAgent = async (thread: ThreadWithMessages) => {
    const frame = thread.frameId ? frames.find((f) => f._id === thread.frameId) : undefined;
    const firstBody = thread.messages[0]?.body ?? "Comment thread";
    const title = firstBody.length > 60 ? `${firstBody.slice(0, 57)}…` : firstBody;
    const opts = {
      title,
      prompt: buildThreadPrompt(thread, frame),
      threadId: thread._id,
      frameId: thread.frameId,
      routePath: frame?.routePath,
    };
    // Local execution when this machine can host it (the original mode);
    // otherwise the cloud carries it. The web app always lands here, which
    // is the point: agents no longer require anyone's Mac to be awake.
    if (window.commons && (repoPath || project?.gitRemote)) await startAgentSession(opts);
    else await startCloudSession(opts);
  };

  const panelSessions: PanelSession[] = convexSessions.map((s) => ({
    id: s._id,
    title: s.title,
    status: s.status,
    routePath: s.routePath,
    hostName: s.host?.name,
    canControl: s.hostUserId === me._id && !!mirrorMap[s._id],
    runner: s.runner ?? undefined,
    branch: s.branch ?? undefined,
    startedAt: s._creationTime,
  }));
  // News watcher: a session finishing is something arriving from elsewhere,
  // whether this machine hosted it or a runner did. idle = finished a turn.
  // Also the tail of the what-if flow: session done → variant frame appears.
  const prevSessionStatus = useRef(new Map<string, string>());
  useEffect(() => {
    for (const s of convexSessions) {
      const was = prevSessionStatus.current.get(s._id);
      prevSessionStatus.current.set(s._id, s.status);
      if (was && was !== "idle" && s.status === "idle") {
        playDraftReady();
        const req = variantRequests.current.get(s._id);
        const branch = (s as { branch?: string }).branch ?? req?.branch;
        if (req && branch) {
          variantRequests.current.delete(s._id);
          void addVariant({
            variantOf: req.frameId,
            prompt: req.prompt,
            branch,
            userId: me._id,
            sessionToken: sessionToken(),
          }).catch(() => {});
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convexSessions]);

  const activePanelId = activeAgentSessionId ?? convexSessions[0]?._id ?? null;
  const transcript = (useQuery(
    api.agentSessions.events,
    activePanelId ? { sessionId: activePanelId as Id<"agentSessions">, userId: me._id, sessionToken: sessionToken() } : "skip"
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
    heartbeat({ userId: me._id, projectId: nav.projectId, sessionToken: sessionToken() });
    const interval = setInterval(() => heartbeat({ userId: me._id, projectId: nav.projectId, sessionToken: sessionToken() }), 15_000);
    return () => clearInterval(interval);
  }, [me._id, nav.projectId, heartbeat]);

  // Start the dev server for local code projects and track its status.
  useEffect(() => {
    // Clear first, before the early return below. devStatus describes one
    // repo, and switching projects has to invalidate it: a project with no
    // working copy on this machine used to inherit the previously-viewed
    // project's running server and render *its* pages in these frames —
    // route "/" showed the wrong app and every other route 404'd. It also
    // held even while the chip correctly said "no live preview", because the
    // chip reads repoPath and the frames read devStatus.
    setDevStatus({ state: "stopped" });
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
    await linkRepo({ projectId: nav.projectId, userId: me._id, repoPath: inspection.repoPath, machineId: machineId ?? undefined, sessionToken: sessionToken() });
    if (inspection.gitRemote && !project?.gitRemote) {
      await setGitRemote({ projectId: nav.projectId, gitRemote: inspection.gitRemote, userId: me._id, sessionToken: sessionToken() });
    }
    // Backfill frames for projects added before their framework was supported.
    if (frames.length === 0 && inspection.routes.length > 0) {
      await rediscover({
        projectId: nav.projectId,
        framework: inspection.framework,
        brandColors: inspection.brandColors,
        frames: layoutFrames(inspection),
        userId: me._id,
        sessionToken: sessionToken(),
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
        userId: me._id,
        sessionToken: sessionToken(),
      });
    })().catch((err) => console.error("auto-discovery failed", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, framesQuery]);

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
        <ServersMenu
          me={me}
          onOpenProject={(projectId) => setNav({ screen: "project", projectId, view: "prototype" })}
        />
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
                if (nav.view === "prototype") setDeviceMenuOpen(!deviceMenuOpen);
                else setNav({ ...nav, view: "prototype" });
              }}
            >
              <Icon name={nav.view === "prototype" ? protoDevice.icon : "play"} />
            </button>
            <button
              className={nav.view === "flow" ? "on" : ""}
              aria-label="Flow"
              title="Flow: how people move through the app"
              onClick={() => {
                setDeviceMenuOpen(false);
                setNav({ ...nav, view: "flow" });
              }}
            >
              <Icon name="flow" />
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
                <ExternalServerRow
                  key={ext.pid + ":" + ext.port}
                  server={ext}
                  repoPath={repoPath}
                  onStopped={() => setExternalServers((list) => list.filter((s) => s.pid !== ext.pid))}
                />
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
        <span className="spacer" />
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
            {/* Named for the outcome, because nobody wants a push — they want
                the link they shared to show what they just changed. */}
            {gitStatus && (gitStatus.dirty || gitStatus.ahead > 0) && (
              <button
                className="btn ghost"
                title={
                  gitStatus.dirty
                    ? "Commit your changes and push them, so your host rebuilds the preview"
                    : "Push your commits, so your host rebuilds the preview"
                }
                onClick={() => setPublishOpen(true)}
              >
                {project.previewUrl ? "Update preview" : "Publish"}
                {gitStatus.ahead > 0 ? ` ↑${gitStatus.ahead}` : ""}
                {gitStatus.dirty ? " •" : ""}
              </button>
            )}
          </>
        )}
        {window.commons && (
          <SettingPopover
            icon="folder"
            label={repoPath ? "Code on this Mac" : "Get the code on this Mac"}
            attention={!repoPath && !project.previewUrl}
            open={openSetting === "repo"}
            onOpenChange={(o) => setOpenSetting(o ? "repo" : null)}
          >
            <div className="reveal-form">
              <span className="reveal-label">Code on this Mac</span>
              {repoPath ? (
                <>
                  <span className="setting-value" title={repoPath}>
                    {repoPath}
                  </span>
                  <div className="reveal-form-row">
                    <button className="btn ghost" onClick={() => void locateRepo()}>
                      Change folder…
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="hint">Screens render live and the agent runs when the code is here.</span>
                  <div className="reveal-form-row">
                    {project.gitRemote && (
                      <button className="btn" disabled={cloning} onClick={() => void cloneProject()} title={project.gitRemote}>
                        <Icon name="download" /> {cloning ? "Cloning…" : "Get the code"}
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => void locateRepo()}>
                      {project.gitRemote ? "I already have it…" : "Choose the folder…"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </SettingPopover>
        )}
        <SettingPopover
          icon="link"
          label="Preview link"
          open={openSetting === "preview"}
          onOpenChange={(o) => setOpenSetting(o ? "preview" : null)}
        >
          <UrlSettingBody
            label="Preview link"
            hint="Your deployed URL. Screens and tests fall back to it."
            placeholder="https://myapp.vercel.app"
            value={project.previewUrl}
            learned={project.previewSource === "github"}
            learnedAt={project.lastDeployAt}
            connection={previewConnectionNote}
            onDiagnose={() => setConnectionOpen(true)}
            onReplayDeploys={
              githubStatus && githubStatus.repoCovered !== false && !githubStatus.seenDeploy
                ? async () => {
                    const result = await replayDeploysAction({
                      projectId: nav.projectId,
                      userId: me._id,
                      sessionToken: sessionToken(),
                    });
                    return result.replayed;
                  }
                : undefined
            }
            // Offered whenever there is anything to sign in to, which is not
            // the same as having a preview URL. Gating this on previewUrl was
            // wrong: a project rendering from a local dev server has the same
            // shared session and the same problem, and gets the same fix — but
            // the button never appeared, so an auth-gated app just looked
            // broken with no way out. Prototype resolves through the same
            // resolveFrameUrl, so it lands on whichever source the frames use.
            onSignIn={
              signInTarget
                ? () => {
                    setOpenSetting(null);
                    setNav({ ...nav, view: "prototype" });
                    setSignInHint(true);
                  }
                : undefined
            }
            validate={(url) => (/^https?:\/\/.+/.test(url) ? null : "Needs a full https:// link.")}
            onSave={async (url) => {
              await setPreviewUrl({
                projectId: project._id,
                userId: me._id,
                sessionToken: sessionToken(),
                previewUrl: url ? url.replace(/\/+$/, "") : undefined,
              });
            }}
          />
        </SettingPopover>
        <SettingPopover
          icon="branch"
          label="Draft previews"
          open={openSetting === "drafts"}
          onOpenChange={(o) => setOpenSetting(o ? "drafts" : null)}
        >
          <UrlSettingBody
            label="Draft previews"
            hint="A live link per agent draft. Paste your host's pattern, {branch} for the name."
            placeholder={`https://${vercelProject ?? "myapp"}-git-{branch}-team.vercel.app`}
            value={project.branchPreviewPattern}
            learned={project.branchPatternSource === "github"}
            learnedAt={project.lastDeployAt}
            connection={previewConnectionNote}
            onDiagnose={() => setConnectionOpen(true)}
            validate={(v) =>
              /^https?:\/\/.+/.test(v) && v.includes("{branch}") ? null : "Needs https:// and a {branch} placeholder."
            }
            onSave={async (patternValue) => {
              await setPreviewUrl({
                projectId: project._id,
                userId: me._id,
                sessionToken: sessionToken(),
                previewUrl: project.previewUrl,
                branchPreviewPattern: patternValue ? patternValue.replace(/\/+$/, "") : undefined,
                hasBranchPattern: true,
              });
            }}
          />
        </SettingPopover>
        <SettingPopover
          icon="layers"
          label="History"
          open={openSetting === "history"}
          onOpenChange={(o) => setOpenSetting(o ? "history" : null)}
        >
          <DeployHistoryBody projectId={project._id} me={me} />
        </SettingPopover>
        <SettingPopover
          icon="frames"
          label="Figma"
          open={openSetting === "figma"}
          onOpenChange={(o) => setOpenSetting(o ? "figma" : null)}
        >
          <FigmaSettingBody project={project} me={me} />
        </SettingPopover>
        <span className="tb-divider" />
        {(repoPath || project.gitRemote || convexSessions.length > 0) && (
          <button
            className={`btn ghost icon-btn ${sidePanel === "agents" ? "active" : ""}`}
            aria-label="Agent sessions"
            title="Agent sessions (A)"
            onClick={() => toggleSidePanel("agents")}
          >
            <Icon name="zap" />
            {runningCount > 0 && <span className="count-badge live">{runningCount}</span>}
          </button>
        )}
        <button
          className={`btn ghost icon-btn ${sidePanel === "narrate" ? "active" : ""}`}
          aria-label="Narrate"
          title="Narrate: design rationale annotations (N)"
          onClick={() => toggleSidePanel("narrate")}
        >
          <Icon name="pen" />
        </button>
        <button
          className={`btn ghost icon-btn ${sidePanel === "coverage" ? "active" : ""}`}
          aria-label="Coverage"
          title="Coverage: what the canvas might be missing (G)"
          onClick={() => toggleSidePanel("coverage")}
        >
          <Icon name="layers" />
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
        <SharePopover
          project={project}
          me={me}
          users={users}
          nav={nav}
          open={openSetting === "share"}
          onOpenChange={(o) => setOpenSetting(o ? "share" : null)}
        />
        {connectionOpen && (
          <ConnectionPanel projectId={project._id} userId={me._id} onClose={() => setConnectionOpen(false)} />
        )}
        {publishOpen && repoPath && gitStatus && (
          <PublishPanel
            repoPath={repoPath}
            branch={gitStatus.branch}
            ahead={gitStatus.ahead}
            onClose={() => setPublishOpen(false)}
            onPublished={() => setGitStatus((prev) => (prev ? { ...prev, dirty: false, ahead: 0 } : prev))}
          />
        )}
      </div>

      {project.lastDeployAt !== undefined && project.lastDeployAt > openedAt && (
        <div className="nudge-banner">
          <span>A newer version of the app just deployed — these frames are showing the previous one.</span>
          <button className="btn" onClick={reloadFrames}>
            Reload (R)
          </button>
        </div>
      )}
      {nav.view === "canvas" && frames.length > 0 && !bloomHintDismissed && (
        <div className="nudge-banner">
          <span>Hover the 👍 under a screen to react · right-click or ⌃-click for dots, GIFs, and what-ifs.</span>
          <button
            className="btn ghost"
            onClick={() => {
              localStorage.setItem("commons.bloomHintSeen", "yes");
              setBloomHintDismissed(true);
            }}
          >
            Got it
          </button>
        </div>
      )}
      {bloom && (
        <div className="bloom-scrim" onMouseDown={() => setBloom(null)} onContextMenu={(e) => { e.preventDefault(); setBloom(null); }}>
          <div
            className="bloom-palette"
            style={{ left: bloom.x, top: bloom.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Emojis moved to the hover bar under each frame (the Meta
                pattern); the bloom keeps the aimed tools. */}
            <button
              className="bloom-item"
              title={`Dot-vote this screen (${votesData?.votesLeft ?? 0} left)`}
              onClick={() => {
                void toggleVote({ frameId: bloom.frame._id, userId: me._id, sessionToken: sessionToken() });
                playThrow();
                setBloom(null);
              }}
            >
              ●
            </button>
            <button
              className="bloom-item"
              title="Throw a GIF here"
              onClick={() => {
                setGifFor(bloom.frame);
                setGifAnchor({ fx: bloom.fx, fy: bloom.fy });
                setGifUrl("");
                setGifNote(null);
                setBloom(null);
              }}
            >
              🎞️
            </button>
            {bloom.frame.kind === "route" && !bloom.frame.variantBranch && (project.gitRemote || repoPath) && (
              <button
                className="bloom-item whatif"
                title="What if… — ask an agent for a live variant"
                onClick={() => {
                  setWhatIf({ frame: bloom.frame });
                  setBloom(null);
                }}
              >
                ✦
              </button>
            )}
          </div>
        </div>
      )}
      {gifFor && (
        <div className="overlay-scrim" onMouseDown={() => setGifFor(null)}>
          <div className="overlay-card" onMouseDown={(e) => e.stopPropagation()}>
            <header>Drop a GIF on {gifFor.title}</header>
            <div
              className="reveal-form"
              onPaste={(e) => {
                const file = e.clipboardData?.files?.[0];
                if (file) {
                  e.preventDefault();
                  void uploadGifFile(file);
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer?.files?.[0];
                if (file) void uploadGifFile(file);
              }}
            >
              <span className="hint">
                {giphy?.key
                  ? "Search, paste a copied GIF, drop a file, or paste a link. One per person per screen; a new one replaces yours."
                  : "Paste a copied GIF, drop a file, or paste a link (Giphy: Share → Copy GIF Link). One per person per screen."}
              </span>
              <div className="reveal-form-row">
                <input
                  autoFocus
                  placeholder={giphy?.key ? "Search Giphy, or paste a link…" : "https://media.giphy.com/…"}
                  value={gifUrl}
                  onChange={(e) => {
                    setGifUrl(e.target.value);
                    setGifNote(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (giphy?.key && !/^https?:/.test(gifUrl.trim())) void searchGiphy(gifUrl);
                      else void submitGif();
                    }
                    if (e.key === "Escape") setGifFor(null);
                  }}
                />
                <button
                  className="btn primary"
                  disabled={!gifUrl.trim()}
                  onClick={() => {
                    if (giphy?.key && !/^https?:/.test(gifUrl.trim())) void searchGiphy(gifUrl);
                    else void submitGif();
                  }}
                >
                  {giphy?.key && !/^https?:/.test(gifUrl.trim()) ? "Search" : "Stick it"}
                </button>
              </div>
              {giphyResults.length > 0 && (
                <div className="giphy-grid">
                  {giphyResults.map((g) => (
                    <img
                      key={g.url}
                      src={g.preview}
                      alt=""
                      onClick={() => {
                        setGifUrl(g.url);
                        setGiphyResults([]);
                        void (async () => {
                          const result = await addGifMutation({
                            frameId: gifFor._id,
                            url: g.url,
                            fx: gifAnchor?.fx,
                            fy: gifAnchor?.fy,
                            userId: me._id,
                            sessionToken: sessionToken(),
                          }).catch(() => ({ ok: false as const, reason: "not_a_gif" as const }));
                          if (result.ok) {
                            playThrow();
                            setGifFor(null);
                            setGifUrl("");
                          } else {
                            setGifNote(result.reason === "frame_full" ? "This screen already wears eight stickers." : "Giphy handed back something unusable.");
                          }
                        })();
                      }}
                    />
                  ))}
                </div>
              )}
              {giphy && !giphy.key && giphy.canSet && (
                <span className="hint">
                  Want search in here? Paste a free Giphy API key once for the whole workspace:{" "}
                  <button
                    className="btn ghost quiet-action"
                    onClick={async () => {
                      const key = gifUrl.trim();
                      if (!key || /^https?:/.test(key)) {
                        setGifNote("Type the key in the box above, then click here.");
                        return;
                      }
                      await setGiphyKey({ projectId: nav.projectId, key, userId: me._id, sessionToken: sessionToken() }).catch(() => {});
                      setGifUrl("");
                      setGifNote(null);
                    }}
                  >
                    save what's in the box as the key
                  </button>
                </span>
              )}
              {gifNote && <span className="form-error">{gifNote}</span>}
            </div>
          </div>
        </div>
      )}
      {whatIf && (
        <div className="overlay-scrim" onMouseDown={() => setWhatIf(null)}>
          <div className="overlay-card" onMouseDown={(e) => e.stopPropagation()}>
            <header>What if…</header>
            <div className="reveal-form">
              <span className="hint">
                One sentence about {whatIf.frame.title}. An agent tries it on a draft branch, and the
                result lands beside the original as a live variant — the real app, changed.
              </span>
              {/* The prerequisite is stated BEFORE the session is spent. A
                  variant without the draft-preview pattern has no address:
                  the agent would run, the money would go, and the new frame
                  would render nothing with no way to fix it from there. */}
              {!project.branchPreviewPattern && (
                <span className="form-error">
                  Variants render from draft branches, and this project has no draft preview
                  pattern yet — the variant would have no address.{" "}
                  <button
                    className="btn ghost quiet-action"
                    onClick={() => {
                      setWhatIf(null);
                      setOpenSetting("drafts");
                    }}
                  >
                    Set the pattern…
                  </button>{" "}
                  Connecting GitHub fills it in from your deploys.
                </span>
              )}
              <div className="reveal-form-row">
                <input
                  autoFocus
                  placeholder="warmer palette · collapse the nav · first-time user view"
                  value={whatIfPrompt}
                  onChange={(e) => setWhatIfPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void fireWhatIf();
                    if (e.key === "Escape") setWhatIf(null);
                  }}
                />
                <button
                  className="btn primary"
                  disabled={!whatIfPrompt.trim() || !project.branchPreviewPattern}
                  onClick={() => void fireWhatIf()}
                >
                  Try it
                </button>
              </div>
              <span className="hint">
                Costs an agent session (the $5 ceiling applies). Variants A/B-test against the
                original from the Tests panel.
              </span>
            </div>
          </div>
        </div>
      )}
      {signInHint && (
        <div className="nudge-banner">
          <span>
            Sign in here once. Every screen on the canvas shares this session, so they'll all load signed in.
          </span>
          <button
            className="btn"
            onClick={() => {
              setSignInHint(false);
              setNav({ ...nav, view: "canvas" });
              reloadFrames();
            }}
          >
            Done — reload screens
          </button>
          <button className="btn ghost" onClick={() => setSignInHint(false)}>
            ✕
          </button>
        </div>
      )}
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
          <button className="btn" onClick={() => setOpenSetting("preview")}>
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

      {nav.view === "flow" ? (
        <>
          <div className="flow-bar">
            <span className="hint">
              {flowEdges === undefined
                ? "Loading paths…"
                : flowEdges.length === 0
                  ? "No paths yet."
                  : `${flowEdges.length} path${flowEdges.length === 1 ? "" : "s"}`}
              {crawl?.status === "starting" || crawl?.status === "running"
                ? ` · Crawling your preview… ${crawl.found} found`
                : crawl?.status === "done"
                  ? ` · Crawl finished, ${crawl.found} found`
                  : ""}
            </span>
            {crawl?.status === "error" && <span className="form-error">{crawl.error ?? "The crawl failed."}</span>}
            {crawlNote && <span className="form-error">{crawlNote}</span>}
            {(flowProposals?.length ?? 0) > 0 && (
              <button className="btn" onClick={() => setReviewOpen(true)}>
                Review states ({flowProposals!.length})
              </button>
            )}
            <button
              className="btn ghost"
              disabled={crawl?.status === "starting" || crawl?.status === "running"}
              title="Send a browser to your deployed preview to find error, empty, and loading states"
              onClick={async () => {
                setCrawlNote(null);
                try {
                  const result = await startCrawl({ projectId: nav.projectId, userId: me._id, sessionToken: sessionToken() });
                  if (!result.ok) {
                    setCrawlNote(
                      result.reason === "no_preview"
                        ? "Needs a preview link — set it in the link popover."
                        : result.reason === "no_repo"
                          ? "Needs a GitHub repository connected."
                          : result.reason === "already_running"
                            ? "A crawl is already running."
                            : "You don't have access to this project."
                    );
                  }
                } catch (err) {
                  // Anything still thrown is genuinely unexpected — say so
                  // rather than printing transport noise.
                  console.error("startCrawl failed", err);
                  setCrawlNote("Couldn't start — something unexpected went wrong.");
                }
              }}
            >
              Find error &amp; empty states
            </button>
            <button
              className="btn ghost"
              disabled={deriving}
              onClick={async () => {
                setDeriving(true);
                setCrawlNote(null);
                try {
                  const result = await deriveFlow({
                    projectId: nav.projectId,
                    userId: me._id,
                    sessionToken: sessionToken(),
                  });
                  setCrawlNote(
                    result.sessions === 0
                      ? "No tester sessions yet."
                      : `${result.edges} path${result.edges === 1 ? "" : "s"} from ${result.sessions} session${result.sessions === 1 ? "" : "s"}.`
                  );
                } catch (err) {
                  setCrawlNote(err instanceof Error ? err.message : String(err));
                } finally {
                  setDeriving(false);
                }
              }}
            >
              {deriving ? "Reading…" : "Draw from tester sessions"}
            </button>
          </div>
          {/* Hand-drawn paths. The form only exists while wanted: an always-on
              row of bare dropdowns read as furniture with no purpose (a user
              said exactly that), so the door is a sentence and the form is
              one too. */}
          {!drawOpen && (
            <div className="flow-connect">
              <button className="btn ghost" onClick={() => setDrawOpen(true)}>
                Draw a path by hand…
              </button>
            </div>
          )}
          {drawOpen && (
          <div className="flow-connect">
            <span className="hint">A person on</span>
            <select value={connectFrom} onChange={(e) => setConnectFrom(e.target.value)}>
              <option value="">this screen…</option>
              {frames.map((f) => (
                <option key={f._id} value={f._id}>
                  {f.title}
                  {f.routePath ? ` · ${f.routePath}` : ""}
                </option>
              ))}
            </select>
            <span className="hint">can get to</span>
            <select value={connectTo} onChange={(e) => setConnectTo(e.target.value)}>
              <option value="">this one…</option>
              {frames.map((f) => (
                <option key={f._id} value={f._id}>
                  {f.title}
                  {f.routePath ? ` · ${f.routePath}` : ""}
                </option>
              ))}
            </select>
            <input
              placeholder="by doing what? e.g. “tapping Buy”"
              value={connectLabel}
              onChange={(e) => setConnectLabel(e.target.value)}
            />
            <button
              className="btn ghost"
              disabled={!connectFrom || !connectTo || connectFrom === connectTo}
              onClick={async () => {
                setCrawlNote(null);
                try {
                  await addFlowEdge({
                    projectId: nav.projectId,
                    fromFrameId: connectFrom as Id<"frames">,
                    toFrameId: connectTo as Id<"frames">,
                    label: connectLabel.trim() || undefined,
                    userId: me._id,
                    sessionToken: sessionToken(),
                  });
                  setConnectFrom("");
                  setConnectTo("");
                  setConnectLabel("");
                  setDrawOpen(false);
                } catch (err) {
                  setCrawlNote(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              Draw it
            </button>
            <button className="btn ghost icon-btn" aria-label="Close" onClick={() => setDrawOpen(false)}>
              ✕
            </button>
          </div>
          )}
          {reviewOpen && (
            <FlowReviewPanel
              proposals={flowProposals ?? []}
              me={me}
              onClose={() => setReviewOpen(false)}
            />
          )}
          <CanvasView
            me={me}
            projectId={nav.projectId}
            frames={frames}
            threads={threads}
            users={users}
            mentionUsers={mentionUsers}
            devStatus={{ state: "stopped" }}
            previewUrl={null}
            positionOverride={flowPos}
            flowEdges={flowEdges ?? []}
            onSendToAgent={repoPath || project.gitRemote ? sendThreadToAgent : undefined}
          />
        </>
      ) : nav.view === "canvas" ? (
        <CanvasView
          me={me}
          projectId={nav.projectId}
          frames={canvasFrames}
          threads={threads}
          users={users}
          mentionUsers={mentionUsers}
          devStatus={liveStatus}
          previewUrl={project.previewUrl}
          viewerHasRepo={!!repoPath}
          selfHasRepoElsewhere={!repoPath && selfHasRepoElsewhere}
          repoHolderNames={holderNames}
          initialThreadId={nav.threadId}
          initialFrameId={nav.frameId}
          frameReloadTokens={frameReloadTokens}
          onSendToAgent={repoPath || project.gitRemote ? sendThreadToAgent : undefined}
          webLinkBase={
            project.shareToken
              ? `${publicSite}/g/${project.shareToken}`
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
          branchPreviewPattern={project.branchPreviewPattern}
          reactions={reactionsByFrame}
          votes={votesData?.byFrame}
          onReact={(frameId, emoji) =>
            void toggleReaction({ frameId, emoji, userId: me._id, sessionToken: sessionToken() }).catch(() => {})
          }
          onVote={(frameId) =>
            void toggleVote({ frameId, userId: me._id, sessionToken: sessionToken() })
              .then((r) => {
                if (r && "budgetSpent" in r && r.budgetSpent) alert("All five of your dots are spent — take one back first.");
              })
              .catch(() => {})
          }
          onWhatIf={project.gitRemote || repoPath ? (frame) => setWhatIf({ frame }) : undefined}
          gifs={gifsByFrame}
          onAddGif={(frame) => {
            setGifFor(frame);
            setGifUrl("");
            setGifNote(null);
          }}
          onRemoveGif={(frameId) => void removeGif({ frameId, userId: me._id, sessionToken: sessionToken() })}
          onEditNote={(note) =>
            void curateAnnotation({
              annotationId: note._id as Id<"annotations">,
              action: "edit",
              text: note.text,
              userId: me._id,
              sessionToken: sessionToken(),
            }).catch(() => {})
          }
          onBloom={(frame, x, y, fx, fy) => setBloom({ frame, x, y, fx, fy })}
          supportsDarkMode={project.supportsDarkMode === true}
        />
      ) : (
        <PrototypeView
          frames={canvasFrames}
          devStatus={liveStatus}
          previewUrl={project.previewUrl}
          viewerHasRepo={!!repoPath}
          selfHasRepoElsewhere={!repoPath && selfHasRepoElsewhere}
          repoHolderNames={holderNames}
          project={project}
          me={me}
          onShowHeatmap={(testId) => {
            setHeatmapTestId(testId);
            setNav({ ...nav, view: "canvas" });
          }}
          onSendToAgent={
            repoPath || project.gitRemote
              ? (title, prompt, routePath) =>
                  void (window.commons && (repoPath || project.gitRemote)
                    ? startAgentSession({ title, prompt, routePath })
                    : startCloudSession({ title, prompt, routePath }))
              : undefined
          }
          device={protoDevice}
        />
      )}

      {sidePanel === "coverage" && (
        <CoverageLedger
          project={project}
          me={me}
          frames={frames}
          baseUrl={liveStatus.state === "ready" ? liveStatus.url : project.previewUrl ?? null}
          routes={frames
            .filter((f) => f.kind === "route" && !f.variantBranch)
            .map((f) => ({ path: f.routePath ?? "/", dynamic: (f.routePath ?? "").includes("[") }))}
          onGoReview={() => {
            setSidePanel(null);
            setNav({ ...nav, view: "flow" });
          }}
          onSignIn={
            signInTarget
              ? () => {
                  setSidePanel(null);
                  setNav({ ...nav, view: "prototype" });
                  setSignInHint(true);
                }
              : undefined
          }
          onClose={() => setSidePanel(null)}
        />
      )}
      {sidePanel === "narrate" && (
        <NarrationPanel
          me={me}
          project={project}
          frames={canvasFrames}
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
          repoPath={repoPath}
          onReconcile={(branch, baseBranch, conflicts) => void reconcileDraft(branch, baseBranch, conflicts)}
        />
      )}

      {compare && (
        <CompareDraft
          title={compare.title}
          mainUrl={resolveFrameUrl(compare.routePath ?? "/", liveStatus, project.previewUrl)?.url ?? null}
          draftUrl={`${compare.draftPreviewUrl}${compare.routePath ?? ""}`}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}
