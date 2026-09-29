/**
 * Which of a project's screens its home card lays on the table. Pure (no
 * database), so the rule is testable on its own; projects.listWithActivity
 * walks the ranking, looks up snapshots, and keeps the first few it can show.
 */

import { isPortraitScreen } from "@commons/shared";

export interface CoverFrameLike {
  _id: string;
  kind: "route" | "figma" | "state";
  routePath?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  deletedAt?: number;
  copyOf?: string;
  variantBranch?: string;
}

/** A table holds three portrait screens abreast, or two landscape ones. */
export const COVER_MAX = 3;
/** How many ranked frames the query may probe for snapshots. Bounds the reads. */
export const COVER_PROBE = 6;

/** Phones (and anything taller than wide) fan out; wider screens stack. */
export const isPortrait = isPortraitScreen;

/**
 * Candidates in the order the card wants them: the screen holding the newest
 * open comment (so its pin can show where the conversation is), then the home
 * route, then the canvas in reading order. States, hand-made copies, what-if
 * variants, and deleted frames are near-duplicates or gone, so they never lead.
 */
export function rankCoverFrames<F extends CoverFrameLike>(frames: F[], newestOpenFrameId?: string): F[] {
  const live = frames
    .filter((f) => !f.deletedAt && !f.copyOf && !f.variantBranch && f.kind !== "state")
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const ranked: F[] = [];
  const take = (f: F | undefined) => {
    if (f && !ranked.includes(f)) ranked.push(f);
  };
  if (newestOpenFrameId) take(live.find((f) => f._id === newestOpenFrameId));
  take(live.find((f) => f.kind === "route" && (f.routePath ?? "") === "/"));
  for (const f of live) take(f);
  return ranked;
}

/** How many screens fit on the table, given the one that leads. */
export function coverCapacity(lead: { width: number; height: number } | undefined): number {
  if (!lead) return 0;
  return isPortrait(lead) ? COVER_MAX : 2;
}

/** "Kyle Cooney" reads as "Kyle" on a card; guests keep what they typed. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "Someone";
}
