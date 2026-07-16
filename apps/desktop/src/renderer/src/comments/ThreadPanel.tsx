import { useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import type { ThreadWithMessages } from "./types";
import Composer from "./Composer";
import MessageText from "./MessageText";
import { initials, timeAgo } from "../lib/session";

interface Props {
  thread: ThreadWithMessages;
  me: Doc<"users">;
  users: Doc<"users">[];
  /** Who can be @mentioned — narrower than `users` on private projects. */
  mentionUsers?: Doc<"users">[];
  onClose: () => void;
  /** Present when the project has a local repo — sends this thread to a coding agent. */
  onSendToAgent?: () => void;
}

export default function ThreadPanel({ thread, me, users, mentionUsers, onClose, onSendToAgent }: Props) {
  const reply = useMutation(api.comments.reply);
  const setResolved = useMutation(api.comments.setResolved);
  const resolved = !!thread.resolvedAt;

  return (
    <div className="thread-panel">
      <header>
        <span>Thread {resolved && <span className="hint">· resolved</span>}</span>
        <div style={{ display: "flex", gap: 6 }}>
          {onSendToAgent && (
            <button className="btn ghost" title="Send this thread to a coding agent" onClick={onSendToAgent}>
              ⚡ Agent
            </button>
          )}
          <button
            className="btn ghost"
            title={resolved ? "Reopen" : "Resolve"}
            onClick={() => setResolved({ threadId: thread._id, resolved: !resolved })}
          >
            {resolved ? "Reopen" : "Resolve"}
          </button>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
      </header>
      <div className="thread-messages">
        {thread.messages.map((message) => (
          <div className="msg" key={message._id}>
            <span
              className="avatar"
              style={{ background: message.author?.avatarColor ?? "var(--text-tertiary)" }}
            >
              {initials(message.author?.name ?? "?")}
            </span>
            <div className="body">
              <div className="who">
                {message.author?.name ?? "Unknown"}
                <span className="when">{timeAgo(message._creationTime)}</span>
              </div>
              <div className="text">
                <MessageText body={message.body} users={users} />
              </div>
              {message.imageUrls && message.imageUrls.length > 0 && (
                <div className="msg-images">
                  {message.imageUrls.map((url, i) => (
                    <button
                      key={i}
                      title="Open full size"
                      onClick={() => (window.commons ? void window.commons.openExternal(url) : window.open(url))}
                    >
                      <img src={url} alt={`attachment ${i + 1}`} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <Composer
        users={mentionUsers ?? users}
        me={me}
        placeholder="Reply…"
        submitLabel="Reply"
        onSubmit={async (body, mentions) => {
          await reply({ threadId: thread._id, authorId: me._id, body, mentions });
        }}
      />
    </div>
  );
}
