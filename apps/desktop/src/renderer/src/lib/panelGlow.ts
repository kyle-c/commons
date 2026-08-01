/**
 * A warm point of light under the cursor on panels and popovers, which swells
 * while the pointer rests and settles back the moment it moves.
 *
 * The intent is presence rather than decoration: a panel you're reading should
 * feel gently lit where you're looking, and the slow swell rewards stillness —
 * you notice it only if you stop, which is exactly when a surface should feel
 * alive rather than inert.
 *
 * Built as one delegated listener instead of a component so every panel gets
 * it, including ones that don't exist yet, with no prop to thread and nothing
 * to remember at each call site.
 *
 * Performance is the whole design:
 * - The orb is a fixed-size gradient moved and scaled by `transform` alone, so
 *   it lives on the compositor and never repaints the panel underneath. The
 *   canvas cursor trail uses this same trick for the same reason.
 * - The rAF loop runs only while a pointer is actually over a panel, and stops
 *   itself the moment the glow reaches its cap or the pointer leaves. An idle
 *   app schedules no frames.
 * - One orb per panel, created lazily on first hover and reused thereafter.
 *
 * Skipped entirely under prefers-reduced-motion: a growing light is still
 * motion, and nobody needs it to use the tool.
 */

const PANEL_SELECTOR = ".titlebar-popover, .overlay-card, .agent-panel, .flow-review";

/** Resting radius multiplier, and the cap it swells to while the cursor rests. */
const BASE_SCALE = 1;
const MAX_SCALE = 1.85;
/** How long a still cursor takes to reach the cap. */
const SWELL_MS = 2600;

interface GlowState {
  orb: HTMLElement;
  /** When the pointer last moved — the clock the swell is measured from. */
  restingSince: number;
  x: number;
  y: number;
}

const states = new WeakMap<HTMLElement, GlowState>();
let active: HTMLElement | null = null;
let frame = 0;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function orbFor(panel: HTMLElement): GlowState {
  const existing = states.get(panel);
  if (existing) return existing;
  const orb = document.createElement("div");
  orb.className = "panel-glow";
  orb.setAttribute("aria-hidden", "true");
  // Prepended so it sits under the panel's content in paint order without
  // needing a z-index on every child.
  panel.prepend(orb);
  const state: GlowState = { orb, restingSince: performance.now(), x: 0, y: 0 };
  states.set(panel, state);
  return state;
}

function paint(state: GlowState, now: number): void {
  const rested = Math.min(1, (now - state.restingSince) / SWELL_MS);
  // Ease-out: most of the growth lands early, then it creeps to the cap, so
  // the swell reads as settling rather than inflating.
  const eased = 1 - (1 - rested) ** 3;
  const scale = BASE_SCALE + (MAX_SCALE - BASE_SCALE) * eased;
  state.orb.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${scale.toFixed(3)})`;
  state.orb.style.opacity = String(0.55 + 0.45 * eased);
}

function tick(): void {
  frame = 0;
  if (!active) return;
  const state = states.get(active);
  if (!state) return;
  const now = performance.now();
  paint(state, now);
  // Stop scheduling once the swell is capped — a resting cursor should cost
  // nothing after it has finished growing.
  if (now - state.restingSince < SWELL_MS) frame = requestAnimationFrame(tick);
}

function onPointerMove(event: PointerEvent): void {
  const target = event.target as HTMLElement | null;
  const panel = target?.closest?.(PANEL_SELECTOR) as HTMLElement | null;

  if (!panel) {
    if (active) {
      states.get(active)?.orb.classList.remove("on");
      active = null;
    }
    return;
  }

  if (active && active !== panel) states.get(active)?.orb.classList.remove("on");
  active = panel;

  const state = orbFor(panel);
  const rect = panel.getBoundingClientRect();
  // Add scroll so the light stays under the cursor in a scrolled panel.
  state.x = event.clientX - rect.left + panel.scrollLeft;
  state.y = event.clientY - rect.top + panel.scrollTop;
  state.restingSince = performance.now();
  state.orb.classList.add("on");

  paint(state, state.restingSince);
  if (!frame) frame = requestAnimationFrame(tick);
}

function onPointerLeaveWindow(): void {
  if (!active) return;
  states.get(active)?.orb.classList.remove("on");
  active = null;
}

/** Start the effect. Safe to call once at app start; a no-op if unsupported. */
export function initPanelGlow(): () => void {
  if (reducedMotion()) return () => {};
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerleave", onPointerLeaveWindow);
  return () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerleave", onPointerLeaveWindow);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    active = null;
  };
}
