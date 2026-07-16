import { useEffect, useRef, type RefObject } from "react";

/**
 * Close popovers on outside click or Escape. Pass the element that contains
 * both the trigger and the popover; active gates the listeners to open state.
 */
export function useClickOutside(ref: RefObject<HTMLElement | null>, onClose: () => void, active: boolean): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active, ref]);
}
