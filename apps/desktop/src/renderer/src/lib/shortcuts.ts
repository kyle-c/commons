/**
 * Global keyboard shortcuts. Every new surface registers its shortcut here
 * (see CLAUDE.md). Shortcuts are ignored while typing in inputs/textareas.
 * Registrations with a description appear in the "?" cheat sheet, so the
 * keyboard-first convention documents itself.
 */
type ShortcutHandler = (e: KeyboardEvent) => void;

interface Shortcut {
  key: string;
  meta: boolean;
  description?: string;
  handler: ShortcutHandler;
}

const shortcuts = new Set<Shortcut>();
let listening = false;

function ensureListener(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable) return;
    for (const shortcut of shortcuts) {
      if (e.key.toLowerCase() === shortcut.key && (e.metaKey || e.ctrlKey) === shortcut.meta) {
        e.preventDefault();
        shortcut.handler(e);
      }
    }
  });
}

export function registerShortcut(
  key: string,
  handler: ShortcutHandler,
  opts: { meta?: boolean; description?: string } = {}
): () => void {
  ensureListener();
  const shortcut: Shortcut = {
    key: key.toLowerCase(),
    meta: opts.meta ?? false,
    description: opts.description,
    handler,
  };
  shortcuts.add(shortcut);
  return () => {
    shortcuts.delete(shortcut);
  };
}

/** Currently registered shortcuts that carry a description (for the cheat sheet). */
export function listShortcuts(): { key: string; meta: boolean; description: string }[] {
  return [...shortcuts]
    .filter((s): s is Shortcut & { description: string } => !!s.description)
    .map(({ key, meta, description }) => ({ key, meta, description }));
}
