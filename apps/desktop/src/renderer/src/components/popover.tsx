import { useState } from "react";

/**
 * The bare expanded form (input + confirm + dismiss) for callers that supply
 * their own trigger — e.g. the "+" circle in an avatar stack or a state chip.
 */
export function InlineField({
  placeholder,
  submitLabel,
  onSubmit,
  onClose,
  hint,
  initialValue = "",
  allowEmpty = false,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
  hint?: string;
  initialValue?: string;
  allowEmpty?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || (!allowEmpty && !value.trim())) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); // stay open for a fix
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reveal-form">
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="form-error">{error}</span>}
      <div className="reveal-form-row">
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") onClose();
          }}
        />
        <button className="btn primary" disabled={busy || (!allowEmpty && !value.trim())} onClick={() => void submit()}>
          {submitLabel}
        </button>
        <button className="btn ghost" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  );
}

/**
 * Shared popover anatomy (Team, Workspaces, and future titlebar modules):
 * small-caps section labels, identity rows with quiet trailing actions, and
 * inputs that exist only while they're being used (progressive disclosure) —
 * a menu should read as content, not as a stack of forms.
 */

export function PopSection({ label }: { label: string }) {
  return <div className="pop-section">{label}</div>;
}

/**
 * A ghost action row that expands into an input + confirm on demand.
 * Enter confirms, Esc collapses; a resolved submit collapses and clears.
 */
export function RevealField({
  actionLabel,
  placeholder,
  submitLabel,
  onSubmit,
  hint,
  initialValue = "",
  allowEmpty = false,
}: {
  actionLabel: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (value: string) => Promise<void> | void;
  hint?: string;
  initialValue?: string;
  allowEmpty?: boolean;
}) {
  const [openField, setOpenField] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || (!allowEmpty && !value.trim())) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
      setOpenField(false);
      setValue(initialValue);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); // field stays open for a fix
    } finally {
      setBusy(false);
    }
  };

  if (!openField) {
    return (
      <button
        className="btn ghost reveal-trigger"
        onClick={() => {
          setValue(initialValue);
          setError(null);
          setOpenField(true);
        }}
      >
        {actionLabel}
      </button>
    );
  }
  const openLabel = actionLabel
    .replace(/^[✓+]\s*/, "")
    .replace(/\s*·\s*change$/, "")
    .replace(/…$/, "")
    .replace(/\s*\(advanced\)$/, "");
  return (
    <div className="reveal-form">
      <span className="reveal-label">{openLabel}</span>
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="form-error">{error}</span>}
      <div className="reveal-form-row">
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") setOpenField(false);
          }}
        />
        <button className="btn primary" disabled={busy || (!allowEmpty && !value.trim())} onClick={() => void submit()}>
          {submitLabel}
        </button>
        <button className="btn ghost" onClick={() => setOpenField(false)}>
          ✕
        </button>
      </div>
    </div>
  );
}
