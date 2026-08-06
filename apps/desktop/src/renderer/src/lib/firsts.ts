/**
 * First-time milestones, marked where they actually happen.
 *
 * The getting-started checklist completes itself from these — a checklist
 * that checks off because you clicked "next" teaches clicking next; one that
 * checks off because you commented teaches commenting. localStorage is the
 * right ledger: it's per-machine, it needs no schema, and being wrong in
 * either direction costs one redundant checkmark, not data.
 */

export type FirstKey = "opened" | "comment" | "reaction" | "whatif" | "agent" | "test" | "prototype";

/**
 * Scoped per user, not per machine. The first cut shared one key across
 * accounts, so a second account on the same Mac inherited the first one's
 * milestones — its checklist was born completed and never appeared. The
 * author found it by doing the obvious test the code hadn't: sign out,
 * sign up fresh.
 */
const KEY = "commons.firsts";

let currentUser = "";
/** App calls this once the signed-in user is known; marks before it no-op. */
export function setFirstsUser(userId: string): void {
  currentUser = userId;
}

function read(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(`${KEY}.${currentUser}`) ?? "{}");
  } catch {
    return {};
  }
}

export function markFirst(key: FirstKey): void {
  if (!currentUser) return;
  const firsts = read();
  if (firsts[key]) return;
  firsts[key] = Date.now();
  localStorage.setItem(`${KEY}.${currentUser}`, JSON.stringify(firsts));
  // Same-window listeners (the home card) hear it immediately; the storage
  // event only fires cross-window.
  window.dispatchEvent(new CustomEvent("commons:first", { detail: { key } }));
}

export function hasFirst(key: FirstKey): boolean {
  return Boolean(read()[key]);
}
