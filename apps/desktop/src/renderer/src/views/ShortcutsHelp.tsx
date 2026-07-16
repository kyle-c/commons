import { useEffect, useState } from "react";
import { listShortcuts, registerShortcut } from "../lib/shortcuts";

const KEY_LABELS: Record<string, string> = { escape: "esc", "=": "+" };

/** "?" opens a cheat sheet generated from whatever shortcuts are registered. */
export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(
    () => registerShortcut("?", () => setOpen((o) => !o), { description: "Keyboard shortcuts" }),
    []
  );
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const items = listShortcuts().filter((s) => s.key !== "?");

  return (
    <div className="overlay-scrim" onMouseDown={() => setOpen(false)}>
      <div className="overlay-card" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <span>Keyboard shortcuts</span>
          <button className="btn ghost" onClick={() => setOpen(false)}>
            ✕
          </button>
        </header>
        <div className="shortcut-list">
          {items.map((s) => (
            <div key={`${s.meta}-${s.key}`} className="shortcut-row">
              <span>{s.description}</span>
              <span className="keys">
                {s.meta && <kbd>⌘</kbd>}
                <kbd>{(KEY_LABELS[s.key] ?? s.key).toUpperCase()}</kbd>
              </span>
            </div>
          ))}
          <div className="shortcut-row">
            <span>Release focused frame / close panels</span>
            <span className="keys">
              <kbd>ESC</kbd>
            </span>
          </div>
        </div>
        <div className="hint" style={{ padding: "0 16px 14px" }}>
          Press ? anywhere to open this sheet.
        </div>
      </div>
    </div>
  );
}
