const CONVEX_URL_KEY = "commons.convexUrl";
const SESSION_KEY = "commons.session";

export function getConvexUrl(): string | null {
  return localStorage.getItem(CONVEX_URL_KEY) || import.meta.env.VITE_CONVEX_URL || null;
}

export function setConvexUrl(url: string): void {
  localStorage.setItem(CONVEX_URL_KEY, url.trim());
}

/** The signed-in session, minted by Google sign-in and validated on launch. */
export interface StoredSession {
  userId: string;
  token: string;
}

export function getStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.userId === "string" && typeof parsed?.token === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function setStoredSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Proof-of-identity for viewer-scoped Convex calls: the server resolves the
 * viewer from this token instead of trusting the userId argument.
 */
export function sessionToken(): string | undefined {
  return getStoredSession()?.token;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
