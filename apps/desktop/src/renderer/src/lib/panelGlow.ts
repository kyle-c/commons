/**
 * A warm point of light under the cursor on panels and popovers, which swells
 * while the pointer rests and settles back the moment it moves.
 *
 * The intent is presence rather than decoration: a panel you're reading should
 * feel gently lit where you're looking, and the slow swell rewards stillness —
 * you notice it only if you stop, which is exactly when a surface should feel
 * alive rather than inert.
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

/** Resting size multiplier, and the cap it swells to while the cursor rests. */
const BASE_SCALE = 1;
const MAX_SCALE = 1.7;
/** How long a still cursor takes to reach the cap. */
const SWELL_MS = 2800;

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
  const rested = Math.min(1, (now - restingSince) / SWELL_MS);
  // Ease-out: most of the growth lands early, then it creeps to the cap, so
  // the swell reads as settling rather than inflating.
  const eased = 1 - (1 - rested) ** 3;
  const scale = BASE_SCALE + (MAX_SCALE - BASE_SCALE) * eased;
  orb.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale.toFixed(3)})`;
}

function tick(): void {
  frame = 0;
  if (!over) return;
  const now = performance.now();
  paint(now);
  // Once capped, a resting cursor should cost nothing.
  if (now - restingSince < SWELL_MS) frame = requestAnimationFrame(tick);
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
  ensureOrb().classList.add("on");

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
