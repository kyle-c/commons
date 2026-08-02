import { useEffect } from "react";

/**
 * One transient surface at a time, across components that share no state.
 *
 * The interaction model (DESIGN.md) says popovers and panels never coexist,
 * and ProjectView enforces that for the surfaces it owns — but the titlebar's
 * global menus (inbox, team, workspaces, servers, account) each keep private
 * open state, so the rule silently didn't apply between them: the inbox
 * slideout and the team popover could sit open together.
 *
 * This is the smallest thing that makes the rule global: opening any surface
 * claims the floor over a window event, and every other surface hearing a
 * claim that isn't its own closes. No provider, no store, no coordination
 * between files beyond the id.
 */

const EVENT = "commons:surface";

/** Announce that a surface just opened. Everyone else yields. */
export function claimSurface(id: string): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id } }));
}

/** Claim the floor while `open`; yield whenever someone else claims it. */
export function useSurfaceExclusivity(id: string, open: boolean, close: () => void): void {
  useEffect(() => {
    if (open) claimSurface(id);
  }, [open, id]);
  useEffect(() => {
    if (!open) return;
    const onClaim = (e: Event) => {
      if ((e as CustomEvent).detail?.id !== id) close();
    };
    window.addEventListener(EVENT, onClaim);
    return () => window.removeEventListener(EVENT, onClaim);
  }, [open, id, close]);
}
