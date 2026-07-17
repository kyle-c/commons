import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import { initials, sessionToken } from "../lib/session";
import { useClickOutside } from "../lib/useClickOutside";

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
  const [webhookDraft, setWebhookDraft] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState<Record<string, string>>({});
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

  const submitMember = async (workspaceId: Id<"workspaces">) => {
    const email = (memberEmail[workspaceId] ?? "").trim();
    if (!email) return;
    const result = await addMember({ workspaceId, userId: me._id, sessionToken: sessionToken(), email });
    if (result.ok) {
      setMemberEmail((prev) => ({ ...prev, [workspaceId]: "" }));
      setNotice(result.joined ? `${email} joined.` : `${email} will join when they first sign in — invite sent.`);
    } else {
      setNotice(`Couldn't add: ${result.reason}`);
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
                  </div>
                  <div className="team-invite">
                    <input
                      placeholder="Add by email…"
                      value={memberEmail[workspace._id] ?? ""}
                      onChange={(e) => setMemberEmail((prev) => ({ ...prev, [workspace._id]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && submitMember(workspace._id)}
                    />
                    <button className="btn" onClick={() => submitMember(workspace._id)}>
                      Add
                    </button>
                  </div>
                  <div className="team-invite">
                    <input
                      placeholder="Slack webhook URL for this workspace's activity…"
                      title="New threads and agent results post here — create an incoming webhook in Slack and paste it"
                      value={webhookDraft[workspace._id] ?? workspace.slackWebhookUrl ?? ""}
                      onChange={(e) => setWebhookDraft((prev) => ({ ...prev, [workspace._id]: e.target.value }))}
                    />
                    <button
                      className="btn"
                      disabled={webhookDraft[workspace._id] === undefined}
                      onClick={async () => {
                        try {
                          await setSlackWebhook({
                            workspaceId: workspace._id,
                            userId: me._id,
                            sessionToken: sessionToken(),
                            webhookUrl: webhookDraft[workspace._id] || undefined,
                          });
                          setNotice("Slack channel saved.");
                          setWebhookDraft((prev) => {
                            const next = { ...prev };
                            delete next[workspace._id];
                            return next;
                          });
                        } catch (err) {
                          setNotice(err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      Save
                    </button>
                  </div>
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
            <button className="btn ghost" style={{ margin: "4px 14px 12px" }} onClick={() => setCreating(true)}>
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
