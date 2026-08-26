import * as React from "react";

/**
 * THE SHELL'S RESPONSIVE LADDER, TABLET-FIRST (mockups §4, all four directions):
 *
 *   >= 1280   the full sidebar          (--sidebar-w)
 *   1024-1279 the collapsed icon rail   (--rail)
 *   <  1024   an off-canvas drawer + the bottom tab bar
 *
 * The old breakpoint was 768, which put a 10" kitchen tablet in landscape on the
 * DESKTOP rung: a 268px sidebar eating a third of the screen, and no drawer. 1024 is
 * the line the mockups draw and the line this app is actually used at.
 */
const MOBILE_BREAKPOINT = 1024;
const RAIL_BREAKPOINT = 1280;

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

/**
 * The middle rung: tablet landscape, where the sidebar is ALWAYS the icon rail.
 *
 * It is not a preference on this rung — the mockups hide the toggle entirely between
 * 1024 and 1279 (`.hamburger{display:none}`), because 268px of nav on a 1024px
 * viewport leaves no room for a floor plan. The user's expanded/collapsed choice is
 * still recorded in the cookie and comes back at >= 1280.
 */
function subscribeRail(onChange: () => void): () => void {
  const mql = window.matchMedia(
    `(min-width: ${MOBILE_BREAKPOINT}px) and (max-width: ${RAIL_BREAKPOINT - 1}px)`,
  );
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const getRailSnapshot = () =>
  window.innerWidth >= MOBILE_BREAKPOINT && window.innerWidth < RAIL_BREAKPOINT;

export function useIsRailViewport(): boolean {
  return React.useSyncExternalStore(subscribeRail, getRailSnapshot, getServerSnapshot);
}
