import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import { initials, sessionToken } from "../lib/session";
import { registerShortcut } from "../lib/shortcuts";
import { useClickOutside } from "../lib/useClickOutside";

const INVITE_ERRORS = {
  invalid_email: "That doesn't look like an email address.",
  already_member: "They're already on the team.",
  already_invited: "They already have a pending invite.",
} as const;

/** Titlebar popover: team members, pending invites, invite-by-email. ⌘T. */
export default function Team({ me }: { me: Doc<"users"> }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const users = useQuery(api.users.list, open ? { userId: me._id, sessionToken: sessionToken() } : "skip") ?? [];
  const pending = useQuery(api.invites.pending, open ? {} : "skip") ?? [];
  const pulse = useQuery(api.metrics.pilot, open ? { userId: me._id } : "skip");
  const invite = useMutation(api.invites.create);
  const revoke = useMutation(api.invites.revoke);

  useEffect(() => registerShortcut("t", () => setOpen((o) => !o), { meta: true, description: "Team & invites" }), []);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

  const send = async () => {
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const result = await invite({ email: value, invitedBy: me._id });
      if (result.ok) {
        setEmail("");
        setNotice(`Invited ${value.toLowerCase()} — they'll get an email.`);
      } else {
        setNotice(INVITE_ERRORS[result.reason]);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button className={`btn ghost ${open ? "active" : ""}`} onClick={() => setOpen(!open)} title="Team (⌘T)">
        Team
      </button>
      {open && (
        <div className="titlebar-popover">
          {users.map((user) => (
            <div key={user._id} className="team-row">
              <span className="avatar" style={{ background: user.avatarColor }}>
                {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}
              </span>
              <span className="who">
                <span className="name">
                  {user.name}
                  {user._id === me._id ? " (you)" : ""}
                </span>
                <span className="email">{user.email}</span>
              </span>
            </div>
          ))}
          {pending.map((item) => (
            <div key={item._id} className="team-row pending">
              <span className="who">
                <span className="name">{item.email}</span>
                <span className="email">invited by {item.inviter?.name ?? "a teammate"}</span>
              </span>
              <button className="btn ghost" onClick={() => revoke({ inviteId: item._id })}>
                Revoke
              </button>
            </div>
          ))}
          <div className="team-invite">
            <input
              value={email}
              placeholder="teammate@company.com"
              onChange={(e) => {
                setEmail(e.target.value);
                setNotice(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button className="btn primary" onClick={send} disabled={!email.trim() || busy}>
              Invite
            </button>
          </div>
          {notice && (
            <div className="hint" style={{ padding: "0 14px 12px" }}>
              {notice}
            </div>
          )}
          {pulse && (
            <div className="pilot-pulse">
              <span className="hint" style={{ fontWeight: 600 }}>
                Pilot pulse (7 days)
              </span>
              <span className="hint">
                {pulse.weeklyActiveUsers}/{pulse.totalUsers} active · {pulse.threadsThisWeek} threads
                {pulse.threadsPriorWeek > 0 && ` (prev ${pulse.threadsPriorWeek})`} · {pulse.draftsPushedThisWeek}{" "}
                drafts pushed
              </span>
              <span className="hint">
                {pulse.medianCycleMs !== null
                  ? `comment→fix median ${Math.round(pulse.medianCycleMs / 60000)} min over ${pulse.agentRepliesTotal} fixes`
                  : "no agent fixes yet"}
                {" · "}
                {pulse.testSessionsThisMonth} test sessions/30d
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
