import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import { initials, sessionToken } from "../lib/session";
import { useSurfaceExclusivity } from "../lib/surfaces";
import { playConnected } from "../lib/sounds";
import { useClickOutside } from "../lib/useClickOutside";
import Icon from "../components/icons";
import { InlineField } from "../components/popover";

const CREATE_ERRORS: Record<string, string> = {
  invalid_name: "Give the workspace a name.",
  invalid_domain: "That doesn't look like a domain (try felixpago.com).",
  consumer_domain: "Consumer email domains can't form a team — add members by email instead.",
  domain_taken: "Another workspace already owns that domain.",
  not_signed_in: "Sign in again and retry.",
};

type WorkspaceRow = { _id: Id<"workspaces">; githubAccounts: { _id: Id<"githubInstallations">; accountLogin: string }[] };

/**
 * Connect GitHub. The install itself happens on github.com, so all this does
 * is mint a state token, hand the person the URL that carries it, and show
 * what's linked once they come back.
 */
function GithubChip({ accounts, open, onToggle }: { accounts: WorkspaceRow["githubAccounts"]; open: boolean; onToggle: () => void }) {
  return (
    <button
      className={`slack-chip ${accounts.length > 0 ? "on" : ""} ${open ? "active" : ""}`}
      title={
        accounts.length > 0
          ? `Deploys from ${accounts.map((a) => a.accountLogin).join(", ")} update this workspace's preview links`
          : "Let Commons pick up preview links from your deploys instead of pasting them"
      }
      onClick={onToggle}
    >
      <span className={`status-dot ${accounts.length > 0 ? "ready" : ""}`} />
      GitHub
    </button>
  );
}

function GithubPanel({ me, workspace }: { me: Doc<"users">; workspace: WorkspaceRow }) {
  const startConnect = useMutation(api.github.startConnect);
  const disconnect = useMutation(api.github.disconnect);
  const [notice, setNotice] = useState<string | null>(null);
  const accounts = workspace.githubAccounts;

  // The GitHub connect finishes in the browser, so the app's first sight of
  // success is this list growing while the menu is open. That reactive
  // arrival is the moment worth marking; a mount with accounts already
  // present is history, not news.
  const prevAccounts = useRef(accounts.length);
  useEffect(() => {
    if (accounts.length > prevAccounts.current) playConnected();
    prevAccounts.current = accounts.length;
  }, [accounts.length]);

  const connect = async () => {
    const result = await startConnect({ workspaceId: workspace._id, userId: me._id, sessionToken: sessionToken() });
    if (!result.ok) {
      setNotice(
        result.reason === "app_not_configured"
          ? "The GitHub App isn't set up on this deployment yet."
          : "You need to be a member of this workspace to connect GitHub."
      );
      return;
    }
    setNotice(
      accounts.length > 0
        ? `GitHub will connect whichever account you're signed in as. Already here: ${accounts
            .map((a) => a.accountLogin)
            .join(", ")}.`
        : "Finish in the browser, then come back — connected accounts show up here."
    );
    if (window.commons) void window.commons.openExternal(result.url);
    else window.open(result.url, "_blank");
  };

  return (
    <div className="ws-github">
      {accounts.map((account) => (
        <div key={account._id} className="ws-github-row">
          <span>{account.accountLogin}</span>
          <button
            className="btn ghost"
            title="Stop using this account's deploys here. Doesn't uninstall anything on GitHub."
            onClick={async () => {
              await disconnect({
                installationRowId: account._id,
                workspaceId: workspace._id,
                userId: me._id,
                sessionToken: sessionToken(),
              });
              setNotice("Disconnected.");
            }}
          >
            Disconnect
          </button>
        </div>
      ))}
      <button className="btn ghost reveal-trigger" onClick={connect}>
        {accounts.length > 0 ? "Connect another account ↗" : "Connect GitHub ↗"}
      </button>
      <div className="hint">
        {notice ??
          (accounts.length > 0
            ? "Deploys from these accounts fill in this workspace's preview links. Connect another if your repos span more than one GitHub account."
            : "Pick the repos you want. After that, every deploy tells Commons the project's preview link and its per-branch draft links.")}
      </div>
    </div>
  );
}

/**
 * Titlebar popover: the viewer's workspaces (playground + teams). Teams are
 * created explicitly — never inferred from a domain — but a corporate domain
 * on a team auto-joins matching sign-ins.
 */
export default function WorkspacesMenu({ me }: { me: Doc<"users"> }) {
  const [open, setOpen] = useState(false);
  useSurfaceExclusivity("workspaces", open, () => setOpen(false));
  const workspaces = useQuery(api.workspaces.mine, open ? { userId: me._id, sessionToken: sessionToken() } : "skip");
  const createWorkspace = useMutation(api.workspaces.create);
  const addMember = useMutation(api.workspaces.addMember);
  const setSlackWebhook = useMutation(api.workspaces.setSlackWebhook);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // One inline editor open at a time, keyed by workspace + which field.
  const [editing, setEditing] = useState<{ id: string; field: "member" | "slack" | "github" } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

  const submitCreate = async () => {
    const result = await createWorkspace({
      userId: me._id,
      sessionToken: sessionToken(),
      name,
      domain: domain || undefined,
    });
    if (result.ok) {
      setCreating(false);
      setName("");
      setDomain("");
      setNotice(null);
    } else {
      setNotice(CREATE_ERRORS[result.reason] ?? result.reason);
    }
  };

  const submitMember = async (workspaceId: Id<"workspaces">, email: string) => {
    const result = await addMember({ workspaceId, userId: me._id, sessionToken: sessionToken(), email });
    if (result.ok) {
      setNotice(result.joined ? `${email} joined.` : `${email} will join when they first sign in. Invite sent.`);
    } else {
      setNotice(`Couldn't add: ${result.reason}`);
      throw new Error(result.reason); // keep the field open for a fix
    }
  };

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className={`btn ghost icon-btn ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label="Workspaces"
        title="Workspaces"
      >
        <Icon name="layers" />
      </button>
      {open && (
        <div className="titlebar-popover workspaces-popover">
          {(workspaces ?? []).map((workspace) => (
            <div key={workspace._id} className="workspace-row">
              <div className="workspace-row-head">
                <strong>{workspace.name}</strong>
                <span className="hint">
                  {workspace.kind === "personal"
                    ? "playground · just you"
                    : workspace.domain
                      ? `team · @${workspace.domain} auto-joins`
                      : "team"}
                </span>
              </div>
              {/* One line: who's here, add someone, Slack and GitHub state.
                  Actions sit with their objects instead of stacking as rows.
                  Playgrounds have no people or Slack, but their projects still
                  deploy, so the GitHub chip is there too. */}
              <div className="ws-line">
                {workspace.kind === "team" && (
                  <>
                    <div className="avatar-stack">
                      {workspace.members.map((member) => (
                        <span
                          key={member._id}
                          className="avatar"
                          style={{ background: member.avatarColor }}
                          title={member.name}
                        >
                          {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : initials(member.name)}
                        </span>
                      ))}
                      <button
                        className="avatar avatar-add"
                        title="Add a member by email"
                        aria-label="Add member"
                        onClick={() =>
                          setEditing((e) =>
                            e?.id === workspace._id && e.field === "member" ? null : { id: workspace._id, field: "member" }
                          )
                        }
                      >
                        +
                      </button>
                    </div>
                    <span style={{ flex: 1 }} />
                    <button
                      className={`slack-chip ${workspace.slackConnected ? "on" : ""}`}
                      title={
                        workspace.slackConnected
                          ? "New threads and agent results post to Slack. Click to change."
                          : "Post new threads and agent results to a Slack channel"
                      }
                      onClick={() =>
                        setEditing((e) =>
                          e?.id === workspace._id && e.field === "slack" ? null : { id: workspace._id, field: "slack" }
                        )
                      }
                    >
                      <span className={`status-dot ${workspace.slackConnected ? "ready" : ""}`} />
                      Slack
                    </button>
                  </>
                )}
                {workspace.kind === "personal" && <span style={{ flex: 1 }} />}
                <GithubChip
                  accounts={workspace.githubAccounts}
                  open={editing?.id === workspace._id && editing.field === "github"}
                  onToggle={() =>
                    setEditing((e) =>
                      e?.id === workspace._id && e.field === "github" ? null : { id: workspace._id, field: "github" }
                    )
                  }
                />
              </div>
              {editing?.id === workspace._id && editing.field === "github" && (
                <GithubPanel me={me} workspace={workspace} />
              )}
              {workspace.kind === "team" && (
                <>
                  {editing?.id === workspace._id && editing.field === "member" && (
                    <InlineField
                      placeholder="teammate@company.com"
                      submitLabel="Add"
                      onClose={() => setEditing(null)}
                      onSubmit={(email) => submitMember(workspace._id, email)}
                    />
                  )}
                  {editing?.id === workspace._id && editing.field === "slack" && (
                    <InlineField
                      submitLabel="Save"
                      allowEmpty
                      initialValue=""
                      placeholder={
                        workspace.slackConnected
                          ? "Connected — paste a new webhook to replace it"
                          : "https://hooks.slack.com/services/…"
                      }
                      hint={
                        <>
                          Posts new threads and agent results to a channel you pick. In Slack, create an
                          incoming webhook and paste its URL here.{" "}
                          <button
                            className="hint-link"
                            onClick={() => {
                              const guide = "https://api.slack.com/messaging/webhooks";
                              if (window.commons) void window.commons.openExternal(guide);
                              else window.open(guide, "_blank");
                            }}
                          >
                            Slack's 2-minute guide ↗
                          </button>
                        </>
                      }
                      onClose={() => setEditing(null)}
                      onSubmit={async (url) => {
                        if (!url) {
                          setEditing(null);
                          return; // blank = leave the current connection untouched
                        }
                        await setSlackWebhook({
                          workspaceId: workspace._id,
                          userId: me._id,
                          sessionToken: sessionToken(),
                          webhookUrl: url,
                        });
                        playConnected();
                        setNotice("Slack channel saved.");
                      }}
                      secondaryLabel={workspace.slackConnected ? "Disconnect" : undefined}
                      onSecondary={async () => {
                        await setSlackWebhook({
                          workspaceId: workspace._id,
                          userId: me._id,
                          sessionToken: sessionToken(),
                          webhookUrl: undefined,
                        });
                        setNotice("Slack channel disconnected.");
                        setEditing(null);
                      }}
                    />
                  )}
                </>
              )}
            </div>
          ))}

          {creating ? (
            <div className="workspace-row">
              <input autoFocus placeholder="Team name — e.g. Felix" value={name} onChange={(e) => setName(e.target.value)} />
              <input
                placeholder="Company domain (optional) — felixpago.com"
                title="Anyone signing in with this email domain joins automatically"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button className="btn ghost" onClick={() => setCreating(false)}>
                  Cancel
                </button>
                <button className="btn primary" disabled={!name.trim()} onClick={submitCreate}>
                  Create team
                </button>
              </div>
            </div>
          ) : (
            <button className="btn ghost reveal-trigger" onClick={() => setCreating(true)}>
              + New team workspace
            </button>
          )}
          {notice && (
            <div className="hint" style={{ padding: "0 14px 12px" }}>
              {notice}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
