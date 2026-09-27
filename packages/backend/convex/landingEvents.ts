/**
 * The landing page's countable events: the beacon (POST /api/lp) accepts
 * these names and drops anything else. Pure on purpose, so the page's test
 * can check the page against this list without loading Convex.
 */
export const LANDING_EVENTS = [
  "view", // the page loaded
  "open_app", // clicked any "Open Commons" link
  "download", // clicked any "Download for Mac" link
  "sticker", // placed a first sticker (once per visit)
  "turn_open", // started the hero demo by clicking a screen (once per visit)
  "turn_send", // sent their demo comment to the agent (once per visit)
] as const;
export type LandingEvent = (typeof LANDING_EVENTS)[number];

export function isLandingEvent(name: string): name is LandingEvent {
  return (LANDING_EVENTS as readonly string[]).includes(name);
}

/** UTC calendar day for a timestamp, e.g. "2026-09-27". */
export function landingDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
