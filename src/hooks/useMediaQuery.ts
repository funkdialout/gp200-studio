import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query from React. Used where a layout change is
 * structural (different markup), not just different styling , CSS handles the
 * rest. Kept in sync with the board.css breakpoints (640px chrome, 720px board).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);
  // server/jsdom-without-matchMedia fallback: assume the desktop layout
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * The board folds its two pedal rows into one swipeable row below this width:
 * two 342px+ rows plus the chain strip and deck don't fit a phone viewport, and
 * a single row keeps the whole chain in one left-to-right reading order.
 */
export function useSingleRowBoard(): boolean {
  return useMediaQuery('(max-width: 720px)');
}

/** True on touch-first devices, where HTML5 drag-and-drop reorder is unavailable. */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

/**
 * Phone cutoff: below this we render a different component tree entirely
 * (`components/mobile/`) instead of the pedalboard, which is built around
 * fixed-width pedal enclosures in a horizontal stage and cannot fold down
 * to ~390px. 639.98px is the exact complement of Tailwind's `sm`
 * (min-width: 640px), so no viewport width can match both.
 *
 * Hysteresis: the phone tree is shorter than the desktop tree, so near the
 * cutoff the desktop layout can grow a vertical scrollbar, which narrows the
 * viewport (~6-17px) below 640px, which swaps in the phone tree, which drops
 * the scrollbar, which widens the viewport back over 640px, and so on. The
 * two layouts then flash at each other forever at a fixed window size. Once a
 * layout is chosen it therefore only flips when the width crosses the cutoff
 * by a margin wider than any scrollbar.
 */
const PHONE_MAX = 639.98;
const HYSTERESIS_PX = 24;

export function useIsPhone(): boolean {
  const query = `(max-width: ${PHONE_MAX}px)`;
  const enter = `(max-width: ${PHONE_MAX - HYSTERESIS_PX}px)`;
  const leave = `(min-width: ${PHONE_MAX + HYSTERESIS_PX}px)`;
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mqls = [query, enter, leave].map((q) => window.matchMedia(q));
    for (const m of mqls) m.addEventListener('change', onChange);
    return () => {
      for (const m of mqls) m.removeEventListener('change', onChange);
    };
  }, [query, enter, leave]);
  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    if (phoneState === null) {
      phoneState = window.matchMedia(query).matches;
    } else if (phoneState && window.matchMedia(leave).matches) {
      phoneState = false;
    } else if (!phoneState && window.matchMedia(enter).matches) {
      phoneState = true;
    }
    return phoneState;
  }, [query, enter, leave]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Module-level so every subscriber agrees and the choice survives re-mounts. */
let phoneState: boolean | null = null;
