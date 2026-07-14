import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Deliberately NOT shadcn's generated version, which sets state inside an effect. That
 * pattern renders once with `undefined`, then immediately re-renders with the real
 * value — a wasted pass on every mount, and it trips react-hooks/set-state-in-effect.
 *
 * useSyncExternalStore is what this is for: React subscribes to the media query
 * directly, reads the value during render, and takes the server snapshot (false, since
 * there is no viewport on the server) for SSR. One render, no flash.
 *
 * `shadcn add` may regenerate this file — if it comes back with useEffect, this is why
 * it was changed.
 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const getSnapshot = () => window.innerWidth < MOBILE_BREAKPOINT;

// No viewport on the server. Assume desktop; the client corrects on hydration.
const getServerSnapshot = () => false;

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
