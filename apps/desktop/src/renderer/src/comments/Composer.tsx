import { useRef, useState } from "react";
import type { Doc, Id } from "@commons/backend/convex/_generated/dataModel";
import { initials } from "../lib/session";

interface Props {
  users: Doc<"users">[];
  me: Doc<"users">;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (body: string, mentions: Id<"users">[]) => void | Promise<void>;
  onCancel?: () => void;
}

/** Comment composer with @mention support: type @ and pick a teammate. */
export default function Composer({ users, me, placeholder, submitLabel, autoFocus, onSubmit, onCancel }: Props) {
  const [body, setBody] = useState("");
  const [mentionIds, setMentionIds] = useState<Id<"users">[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const candidates =
    mentionQuery !== null
      ? users.filter((u) => u._id !== me._id && u.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
      : [];

  const updateMentionQuery = (value: string, caret: number) => {
    const upToCaret = value.slice(0, caret);
    const match = upToCaret.match(/@([A-Za-z]*)$/);
    setMentionQuery(match ? match[1] : null);
  };

  const pickMention = (user: Doc<"users">) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    const upToCaret = body.slice(0, caret).replace(/@([A-Za-z]*)$/, `@${user.name} `);
    setBody(upToCaret + body.slice(caret));
    if (!mentionIds.includes(user._id)) setMentionIds([...mentionIds, user._id]);
    setMentionQuery(null);
    el?.focus();
  };

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    // Only keep mentions whose @Name is still present in the final text.
    const kept = mentionIds.filter((id) => {
      const user = users.find((u) => u._id === id);
      return user && trimmed.includes(`@${user.name}`);
    });
    await onSubmit(trimmed, kept);
    setBody("");
    setMentionIds([]);
  };

  return (
    <div className="thread-compose">
      {candidates.length > 0 && (
        <div className="mention-menu">
          {candidates.slice(0, 5).map((user) => (
            <button key={user._id} onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(user)}>
              <span className="avatar" style={{ background: user.avatarColor, width: 20, height: 20 }}>
                {initials(user.name)}
              </span>
              {user.name}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={body}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setBody(e.target.value);
          updateMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") onCancel?.();
          e.stopPropagation();
        }}
      />
      <div className="row">
        <span className="hint" style={{ marginRight: "auto", alignSelf: "center" }}>
          @ to mention · ⌘↵ to send
        </span>
        {onCancel && (
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn primary" onClick={submit} disabled={!body.trim()}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
