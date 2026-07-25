import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import { initials, sessionToken } from "../lib/session";
import { useClickOutside } from "../lib/useClickOutside";
import { InlineField } from "../components/popover";

const CREATE_ERRORS: Record<string, string> = {
  invalid_name: "Give the workspace a name.",
  invalid_domain: "That doesn't look like a domain (try felixpago.com).",
  consumer_domain: "Consumer email domains can't form a team — add members by email instead.",
  domain_taken: "Another workspace already owns that domain.",
  not_signed_in: "Sign in again and retry.",
};

/**
 * Titlebar popover: the viewer's workspaces (playground + teams). Teams are
 * created explicitly — never inferred from a domain — but a corporate domain
 * on a team auto-joins matching sign-ins.
 */
export default function WorkspacesMenu({ me }: { me: Doc<"users"> }) {
  const [open, setOpen] = useState(false);
  const workspaces = useQuery(api.workspaces.mine, open ? { userId: me._id, sessionToken: sessionToken() } : "skip");
  const createWorkspace = useMutation(api.workspaces.create);
  const addMember = useMutation(api.workspaces.addMember);
  const setSlackWebhook = useMutation(api.workspaces.setSlackWebhook);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // One inline editor open at a time, keyed by workspace + which field.
  const [editing, setEditing] = useState<{ id: string; field: "member" | "slack" } | null>(null);
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
      <button className={`btn ghost ${open ? "active" : ""}`} onClick={() => setOpen(!open)} title="Workspaces">
        Workspaces
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
              {workspace.kind === "team" && (
                <>
                  {/* One line: who's here, add someone, Slack state. Actions
                      sit with their objects instead of stacking as rows. */}
                  <div className="ws-line">
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
                      className={`slack-chip ${workspace.slackWebhookUrl ? "on" : ""}`}
                      title={
                        workspace.slackWebhookUrl
                          ? "New threads and agent results post to Slack. Click to change."
                          : "Post new threads and agent results to a Slack channel"
                      }
                      onClick={() =>
                        setEditing((e) =>
                          e?.id === workspace._id && e.field === "slack" ? null : { id: workspace._id, field: "slack" }
                        )
                      }
                    >
                      <span className={`status-dot ${workspace.slackWebhookUrl ? "ready" : ""}`} />
                      Slack
                    </button>
                  </div>
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
                      placeholder="https://hooks.slack.com/services/…"
                      submitLabel="Save"
                      allowEmpty
                      initialValue={workspace.slackWebhookUrl ?? ""}
                      hint={
                        <>
                          Posts new threads and agent results to a channel you pick. In Slack, create an
                          incoming webhook and paste its URL here (save empty to disconnect).{" "}
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
                        await setSlackWebhook({
                          workspaceId: workspace._id,
                          userId: me._id,
                          sessionToken: sessionToken(),
                          webhookUrl: url || undefined,
                        });
                        setNotice(url ? "Slack channel saved." : "Slack channel disconnected.");
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
