/**
 * First-time milestones, marked where they actually happen.
 *
 * The getting-started checklist completes itself from these — a checklist
 * that checks off because you clicked "next" teaches clicking next; one that
 * checks off because you commented teaches commenting. localStorage is the
 * right ledger: it's per-machine, it needs no schema, and being wrong in
 * either direction costs one redundant checkmark, not data.
 */

export type FirstKey = "comment" | "reaction" | "whatif" | "agent" | "test" | "prototype";

const KEY = "commons.firsts";

function read(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function markFirst(key: FirstKey): void {
  const firsts = read();
  if (firsts[key]) return;
  firsts[key] = Date.now();
  localStorage.setItem(KEY, JSON.stringify(firsts));
  // Same-window listeners (the home card) hear it immediately; the storage
  // event only fires cross-window.
  window.dispatchEvent(new CustomEvent("commons:first", { detail: { key } }));
}

export function hasFirst(key: FirstKey): boolean {
  return Boolean(read()[key]);
}
