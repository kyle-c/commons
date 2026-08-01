/**
 * A warm point of light that appears only once the cursor comes to rest on a
 * panel, then grows slowly outward from where it stopped.
 *
 * Deliberately not a hover effect. Lighting up under a moving cursor made the
 * glow a constant companion — it chased the pointer around and became part of
 * the furniture. Requiring stillness first means it only ever shows up when
 * someone has actually settled on something to read, which is the moment worth
 * marking. Move again and it's gone at once.
 *
 * ONE orb, parented to <body> and positioned in viewport coordinates, rather
 * than one per panel. Living inside a panel meant `overflow-y: auto` clipped
 * the light dead at the border; from the body it spills past the edges, so a
 * panel reads as lit rather than as a rectangle containing a gradient. It also
 * means a single element for the whole app instead of one per surface.
 *
 * Performance is the whole design:
 * - Moved and scaled by `transform` alone, so it lives on the compositor and
 *   never repaints what's beneath it. The canvas cursor trail uses the same
 *   trick for the same reason.
 * - The rAF loop runs only while a pointer is over a panel, and stops itself
 *   once the swell reaches its cap. An idle app schedules no frames.
 *
 * Skipped under prefers-reduced-motion: a growing light is still motion.
 */

const PANEL_SELECTOR = ".titlebar-popover, .overlay-card, .agent-panel, .flow-review";

/** Stillness required before the light appears at all. */
const DWELL_MS = 420;
/** It emerges from a point at the cursor and opens out to the cap. */
const START_SCALE = 0.2;
const MAX_SCALE = 1.7;
/** How long the growth takes once it has appeared. */
const SWELL_MS = 2600;

let orb: HTMLElement | null = null;
let restingSince = 0;
let x = 0;
let y = 0;
let over = false;
let frame = 0;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ensureOrb(): HTMLElement {
  if (!orb) {
    orb = document.createElement("div");
    orb.className = "panel-glow";
    orb.setAttribute("aria-hidden", "true");
    document.body.appendChild(orb);
  }
  return orb;
}

function paint(now: number): void {
  if (!orb) return;
  const still = now - restingSince;
  if (still < DWELL_MS) {
    // Not settled yet: stay dark, but sit at the cursor so the growth begins
    // exactly where the pointer stopped rather than sliding into place.
    orb.classList.remove("on");
    orb.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${START_SCALE})`;
    return;
  }
  const grown = Math.min(1, (still - DWELL_MS) / SWELL_MS);
  // Ease-out: it opens quickly at first, then creeps to the cap, which reads
  // as settling rather than inflating.
  const eased = 1 - (1 - grown) ** 3;
  const scale = START_SCALE + (MAX_SCALE - START_SCALE) * eased;
  orb.classList.add("on");
  orb.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale.toFixed(3)})`;
}

function tick(): void {
  frame = 0;
  if (!over) return;
  const now = performance.now();
  paint(now);
  // Keep ticking through the dwell wait and the growth; once fully open, a
  // resting cursor costs nothing.
  if (now - restingSince < DWELL_MS + SWELL_MS) frame = requestAnimationFrame(tick);
}

function onPointerMove(event: PointerEvent): void {
  const target = event.target as HTMLElement | null;
  const panel = target?.closest?.(PANEL_SELECTOR);

  if (!panel) {
    if (over && orb) {
      over = false;
      orb.classList.remove("on");
    }
    return;
  }

  // Viewport coordinates: the orb is parented to <body>, deliberately outside
  // the panel, so it is never clipped by the panel's own scroll container.
  x = event.clientX;
  y = event.clientY;
  restingSince = performance.now();
  over = true;
  // Any movement puts it out immediately — the whole point is that it marks
  // stillness, so it must never trail a moving pointer.
  ensureOrb().classList.remove("on");

  paint(restingSince);
  if (!frame) frame = requestAnimationFrame(tick);
}

function hide(): void {
  if (!over) return;
  over = false;
  orb?.classList.remove("on");
}

/** Start the effect. Safe to call once at app start; a no-op if unsupported. */
export function initPanelGlow(): () => void {
  if (reducedMotion()) return () => {};
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerleave", hide);
  window.addEventListener("blur", hide);
  return () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerleave", hide);
    window.removeEventListener("blur", hide);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    over = false;
    orb?.remove();
    orb = null;
  };
}
