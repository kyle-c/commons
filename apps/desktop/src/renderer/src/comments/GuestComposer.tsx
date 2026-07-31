import { useState } from "react";
import { rememberGuestName, storedGuestName } from "../lib/guestApi";

/**
 * The composer a share link gets: a name and a message, nothing else.
 *
 * Deliberately not the members' Composer with features turned off. Guests
 * cannot @mention (there is no directory to mention into, and no
 * notifications to send), so rendering the full composer would be a control
 * that looks alive and does nothing. Two fields is the honest shape.
 *
 * The name is asked for once and remembered per browser; it becomes
 * "<name> (guest)" on the thread, which is exactly how the old share page
 * labeled it, so history reads consistently across both eras.
 */
export default function GuestComposer({
  placeholder,
  submitLabel,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  /** Resolves when the write landed; rejections keep the draft for retry. */
  onSubmit: (name: string, body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(storedGuestName());
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const ready = name.trim() !== "" && body.trim() !== "";

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    rememberGuestName(name.trim());
    const ok = await onSubmit(name.trim(), body.trim());
    setBusy(false);
    if (ok) setBody("");
    else setFailed(true);
  };

  return (
    <div className="guest-composer">
      <input
        className="guest-composer-name"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={body}
        rows={2}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape" && onCancel) onCancel();
        }}
      />
      {failed && <span className="guest-composer-error">That didn't post. Check your connection and try again.</span>}
      <div className="guest-composer-actions">
        {onCancel && (
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button className="btn" onClick={() => void submit()} disabled={!ready || busy}>
          {busy ? "Posting…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
