import { useLayoutEffect, useRef } from "react";

/**
 * FLIP: cards glide into a gap instead of appearing in it.
 *
 * Archiving pulls a card into a void, but the grid underneath it is plain
 * layout — the moment reactivity drops the row, every card after it is simply
 * rendered somewhere else, one frame later. The send-off animated the thing
 * leaving and said nothing about the six things that moved, which is the
 * remaining jolt once the vacuum itself is smooth.
 *
 * The technique is First-Last-Invert-Play: measure where each card was, let
 * the browser lay out normally, measure where it ended up, then transform it
 * back to where it started and release it. The browser only ever does one
 * layout; the motion is a compositor-only transform on top of a grid that is
 * already in its final state, so nothing reflows per frame.
 *
 * Positions come from `offsetLeft`/`offsetTop`, not `getBoundingClientRect`.
 * Rects are viewport-relative, so a scroll between two renders reads as every
 * card having moved and animates the whole grid sideways for no reason. Offset
 * positions are layout-relative and, usefully here, unaffected by the very
 * transforms this applies — so a card caught mid-glide still measures from its
 * real slot rather than its animated one.
 *
 * Cards that were not on screen last time (a section unfolding, a project
 * arriving) have nothing to animate from and are deliberately left alone: FLIP
 * describes movement, and an entrance is a different animation.
 */

/** Long enough to read as settling, short enough not to outlast the send-off. */
const REFLOW_MS = 420;
/** Sub-pixel drift from font loading or a scrollbar is not movement. */
const MIN_DELTA_PX = 1.5;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface Spot {
  left: number;
  top: number;
}

/**
 * Which ids moved, and by how much, between two measured layouts.
 *
 * Split out from the DOM work so the decision is testable: no layout engine
 * implements `offsetLeft` outside a real browser, but "did this move, and does
 * that count as movement" is arithmetic and is where the bugs live.
 */
export function planMoves(
  previous: Map<string, Spot>,
  current: Map<string, Spot>
): { id: string; dx: number; dy: number }[] {
  const moves: { id: string; dx: number; dy: number }[] = [];
  for (const [id, spot] of current) {
    const was = previous.get(id);
    // No previous position: an entrance, not a move. FLIP has nothing to say.
    if (!was) continue;
    const dx = was.left - spot.left;
    const dy = was.top - spot.top;
    if (Math.abs(dx) > MIN_DELTA_PX || Math.abs(dy) > MIN_DELTA_PX) {
      moves.push({ id, dx, dy });
    }
  }
  return moves;
}

/**
 * Animate `[data-flip-id]` elements whenever `signature` changes.
 *
 * `signature` should describe the *order and membership* of the list — when it
 * changes, positions are re-measured. Passing something that changes on every
 * render would measure constantly and animate nothing, which is harmless but
 * pointless.
 */
export function useFlip(signature: string): void {
  const previous = useRef<Map<string, { left: number; top: number }>>(new Map());

  useLayoutEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-flip-id]")
    );
    const current = new Map<string, Spot>();
    const byId = new Map<string, HTMLElement>();

    // One measuring pass over everything before a single style is written:
    // interleaving reads and writes here would force a layout per card.
    for (const el of nodes) {
      const id = el.dataset.flipId;
      if (!id) continue;
      current.set(id, { left: el.offsetLeft, top: el.offsetTop });
      byId.set(id, el);
    }

    const moves = planMoves(previous.current, current);
    previous.current = current;
    if (reducedMotion()) return;

    for (const { id, dx, dy } of moves) {
      byId.get(id)?.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        // Ease-out: the card leaves its old slot immediately and settles into
        // the new one, which is the opposite shape to the vacuum's pull and
        // reads as "making room" rather than "being dragged".
        { duration: REFLOW_MS, easing: "cubic-bezier(0.22, 0.9, 0.3, 1)" }
      );
    }
  }, [signature]);
}
