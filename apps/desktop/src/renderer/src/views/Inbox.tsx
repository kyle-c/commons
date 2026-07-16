import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import type { Nav } from "../App";
import { timeAgo } from "../lib/session";
import { registerShortcut } from "../lib/shortcuts";
import { useClickOutside } from "../lib/useClickOutside";

export default function Inbox({ me, setNav }: { me: Doc<"users">; setNav: (nav: Nav) => void }) {
  const [open, setOpen] = useState(false);
  const items = useQuery(api.comments.inbox, { userId: me._id }) ?? [];
  const markRead = useMutation(api.comments.markRead);
  const unread = items.filter((i) => !i.readAt).length;

  useEffect(() => registerShortcut("i", () => setOpen((o) => !o), { meta: true, description: "Inbox" }), []);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button className={`btn ghost ${open ? "active" : ""}`} onClick={() => setOpen(!open)} title="Inbox (⌘I)">
        Inbox{unread > 0 ? ` · ${unread}` : ""}
      </button>
      {open && (
        <div className="titlebar-popover">
          {items.length === 0 && (
            <div style={{ padding: 20, color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
              Nothing yet — you'll see @mentions here.
            </div>
          )}
          {items.map((item) => (
            <button
              key={item._id}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "12px 14px",
                borderBottom: "1px solid var(--border-subtle)",
                opacity: item.readAt ? 0.55 : 1,
              }}
              onClick={() => {
                if (!item.readAt) markRead({ notificationId: item._id });
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
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
                {item.author?.name ?? "Someone"} mentioned you
                <span className="hint" style={{ marginLeft: 6 }}>
                  {item.project?.name} · {timeAgo(item._creationTime)}
                </span>
              </div>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--text-secondary)",
                  marginTop: 3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.message?.body}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
