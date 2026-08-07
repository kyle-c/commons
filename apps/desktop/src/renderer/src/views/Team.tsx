import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import { initials, sessionToken } from "../lib/session";
import { useSurfaceExclusivity } from "../lib/surfaces";
import { registerShortcut } from "../lib/shortcuts";
import { useClickOutside } from "../lib/useClickOutside";
import { markFirst } from "../lib/firsts";
import Icon from "../components/icons";
import { PopSection, RevealField } from "../components/popover";

const INVITE_ERRORS = {
  invalid_email: "That doesn't look like an email address.",
  already_member: "They're already on the team.",
  already_invited: "They already have a pending invite.",
} as const;

/** Titlebar popover: team members, pending invites, invite-by-email. ⌘T. */
export default function Team({ me }: { me: Doc<"users"> }) {
  const [open, setOpen] = useState(false);
  useSurfaceExclusivity("team", open, () => setOpen(false));
  const [notice, setNotice] = useState<string | null>(null);
  const users = useQuery(api.users.list, open ? { userId: me._id, sessionToken: sessionToken() } : "skip") ?? [];
  const pending = useQuery(api.invites.pending, open ? { userId: me._id, sessionToken: sessionToken() } : "skip") ?? [];
  const pulse = useQuery(api.metrics.pilot, open ? { userId: me._id, sessionToken: sessionToken() } : "skip");
  const invite = useMutation(api.invites.create);
  const revoke = useMutation(api.invites.revoke);

  useEffect(() => registerShortcut("t", () => setOpen((o) => !o), { meta: true, description: "Team & invites" }), []);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

  const send = async (value: string) => {
    const result = await invite({ email: value, invitedBy: me._id });
    markFirst("invite");
    if (result.ok) {
      setNotice(`Invited ${value.toLowerCase()}. They'll get an email.`);
    } else {
      setNotice(INVITE_ERRORS[result.reason]);
      throw new Error(INVITE_ERRORS[result.reason]); // keep the field open for a fix
    }
  };

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        className={`btn ghost icon-btn ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label="Team"
        title="Team (⌘T)"
      >
        <Icon name="users" />
      </button>
      {open && (
        <div className="titlebar-popover">
          <PopSection label={`Members · ${users.length}`} />
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
          {pending.length > 0 && <PopSection label={`Invited · ${pending.length}`} />}
          {pending.map((item) => (
            <div key={item._id} className="team-row pending">
              <span className="avatar pending-avatar" title="Joins on first sign-in">
                {initials(item.email)}
              </span>
              <span className="who">
                <span className="name">{item.email}</span>
                <span className="email">invited by {item.inviter?.name ?? "a teammate"}</span>
              </span>
              <button className="btn ghost quiet-action" onClick={() => revoke({ inviteId: item._id })}>
                Revoke
              </button>
            </div>
          ))}
          <RevealField
            actionLabel="+ Invite by email"
            placeholder="teammate@company.com"
            submitLabel="Invite"
            onSubmit={async (value) => {
              setNotice(null);
              await send(value);
            }}
          />
          {notice && (
            <div className="hint" style={{ padding: "4px 14px 10px" }}>
              {notice}
            </div>
          )}
          {pulse && (
            <div className="pilot-pulse">
              <PopSection label="Pilot pulse · 7 days" />
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
                {(pulse.errorsThisWeek ?? 0) > 0 && (
                  <>
                    {" · "}
                    <span style={{ color: "var(--danger, #f87171)" }}>{pulse.errorsThisWeek} app errors</span>
                  </>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
