import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import type { Nav } from "../App";
import { sessionToken, timeAgo } from "../lib/session";
import { registerShortcut } from "../lib/shortcuts";
import Icon from "../components/icons";

/**
 * Inbox: a full-height side panel (same layer as Agent and Narrate), not a
 * popover — mentions are a queue to work through, not a menu to glance at.
 * Controlled mode (open/onOpenChange) lets ProjectView slot it into the
 * exclusive side-panel state; uncontrolled on the home titlebar.
 */
export default function Inbox({
  me,
  setNav,
  open: controlledOpen,
  onOpenChange,
}: {
  me: Doc<"users">;
  setNav: (nav: Nav) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [selfOpen, setSelfOpen] = useState(false);
  const open = controlledOpen ?? selfOpen;
  const setOpen = onOpenChange ?? setSelfOpen;
  const items = useQuery(api.comments.inbox, { userId: me._id, sessionToken: sessionToken() }) ?? [];
  const markRead = useMutation(api.comments.markRead);
  const unread = items.filter((i) => !i.readAt).length;

  useEffect(
    () => registerShortcut("i", () => setOpen(!open), { meta: true, description: "Inbox" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, onOpenChange]
  );

  return (
    <>
      <button
        className={`btn ghost icon-btn ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label="Inbox"
        title="Inbox (⌘I)"
      >
        <Icon name="bell" />
        {unread > 0 && <span className="count-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="agent-panel inbox-panel">
          <header>
            <strong>Inbox</strong>
            {unread > 0 && <span className="hint">{unread} unread</span>}
            <span style={{ flex: 1 }} />
            <button className="btn ghost" onClick={() => setOpen(false)}>
              ✕
            </button>
          </header>
          <div className="inbox-body">
            {items.length === 0 && (
              <div className="inbox-empty hint">Nothing yet. @mentions land here.</div>
            )}
            {items.map((item) => (
              <button
                key={item._id}
                className={`inbox-item ${item.readAt ? "read" : ""}`}
                onClick={() => {
                  if (!item.readAt) markRead({ notificationId: item._id, userId: me._id, sessionToken: sessionToken() });
                  if (item.thread) {
                    setNav({
                      screen: "project",
                      projectId: item.thread.projectId,
                      view: "canvas",
                      threadId: item.thread._id,
                    });
                  }
                  setOpen(false);
                }}
              >
                <div className="inbox-item-head">
                  {item.author?.name ?? "Someone"} mentioned you
                  <span className="hint">
                    {item.project?.name} · {timeAgo(item._creationTime)}
                  </span>
                </div>
                <div className="inbox-item-body">{item.message?.body}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
