import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@commons/backend/convex/_generated/api";
import type { Doc } from "@commons/backend/convex/_generated/dataModel";
import type { ThreadWithMessages } from "./types";
import Composer from "./Composer";
import GuestComposer from "./GuestComposer";
import { postGuestReply } from "../lib/guestApi";
import MessageText from "./MessageText";
import { initials, sessionToken, timeAgo } from "../lib/session";

interface Props {
  thread: ThreadWithMessages;
  /** Null in guest mode: the viewer is whoever holds the link. */
  me: Doc<"users"> | null;
  /** Present in guest mode: the share token, which is also the credential. */
  guestToken?: string;
  users: Doc<"users">[];
  /** Who can be @mentioned — narrower than `users` on private projects. */
  mentionUsers?: Doc<"users">[];
  onClose: () => void;
  /** Present when the project has a local repo — sends this thread to a coding agent. */
  onSendToAgent?: () => void;
  /** The project's /p/<token> web page, when shared — enables ticket-to-pixel links. */
  webLinkBase?: string;
}

export default function ThreadPanel({ thread, me, guestToken, users, mentionUsers, onClose, onSendToAgent, webLinkBase }: Props) {
  const reply = useMutation(api.comments.reply);
  const setResolved = useMutation(api.comments.setResolved);
  const resolved = !!thread.resolvedAt;
  const [webCopied, setWebCopied] = useState(false);

  return (
    <div className="thread-panel">
      <header>
        <span>Thread {resolved && <span className="hint">· resolved</span>}</span>
        <div style={{ display: "flex", gap: 6 }}>
          {webLinkBase && (
            <button
              className="btn ghost"
              title="Copy a browser link to this exact thread — paste it into a ticket; no install or account needed to open"
              onClick={() => {
                void navigator.clipboard.writeText(`${webLinkBase}?thread=${thread._id}`);
                setWebCopied(true);
                setTimeout(() => setWebCopied(false), 1500);
              }}
            >
              {webCopied ? "Copied" : "Web link"}
            </button>
          )}
          {onSendToAgent && (
            <button className="btn ghost" title="Send this thread to a coding agent" onClick={onSendToAgent}>
              ⚡ Agent
            </button>
          )}
          {/* Resolving is a write, so a guest doesn't get the button at all
              rather than one that quietly does nothing. */}
          {me && (
            <button
              className="btn ghost"
              title={resolved ? "Reopen" : "Resolve"}
              onClick={() =>
                setResolved({ threadId: thread._id, resolved: !resolved, userId: me._id, sessionToken: sessionToken() })
              }
            >
              {resolved ? "Reopen" : "Resolve"}
            </button>
          )}
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
              {initials(message.author?.name ?? message.guestName ?? "?")}
            </span>
            <div className="body">
              <div className="who">
                {message.author?.name ?? (message.guestName ? `${message.guestName} (guest)` : "Unknown")}
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
      {me ? (
        <Composer
          users={mentionUsers ?? users}
          me={me}
          placeholder="Reply…"
          submitLabel="Reply"
          onSubmit={async (body, mentions) => {
            await reply({ threadId: thread._id, authorId: me._id, body, mentions });
          }}
        />
      ) : guestToken ? (
        <GuestComposer
          placeholder="Reply as a guest…"
          submitLabel="Reply"
          onSubmit={(name, body) => postGuestReply(guestToken, { threadId: thread._id, name, body })}
        />
      ) : (
        <p className="thread-readonly">You're viewing a shared link, so you can read this thread but not reply.</p>
      )}
    </div>
  );
}
