import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * How far the board is allowed to shrink. Below this the pedals stop being
 * comfortably readable/turnable, so the stage goes back to scrolling instead —
 * shrinking is a fit-more-on-screen affordance, not a zoom-to-fit-anything one.
 */
const MIN_ZOOM = 0.68;

/** Ignore shrinks smaller than half a percent: not worth a repaint. */
const NO_OP_ZOOM = 0.995;

/** Binary-search steps between MIN_ZOOM and 1 — 5 lands inside ~0.01. */
const STEPS = 5;

/**
 * Growing back needs a real gain. Shrinking is always applied (otherwise the
 * board overflows), but a regrow of a single step is exactly the move a
 * feedback loop makes, so it has to be worth at least this much.
 */
const GROW_HYSTERESIS = 0.02;

/**
 * Hunt breaker. If the fit keeps changing its answer while the window itself
 * hasn't changed size, something the zoom affects is feeding back into the
 * measurement (a scrollbar appearing, a line re-wrapping, a label crossing
 * the edge). After this many changes inside the window below, the board
 * settles on the smallest zoom it tried and stays there until the window is
 * resized.
 */
const HUNT_CHANGES = 3;
const HUNT_WINDOW_MS = 1000;

/**
 * Shrink the pedal row just enough to keep the whole board on screen.
 *
 * The board is built from fixed-size enclosures (172/310px bays, 44px knobs,
 * 9px labels), so a narrow window pushes the chain onto extra wrapped lines and
 * the back of it disappears under the floating deck. Rather than reflowing the
 * pedals themselves — which would restack knobs and make them *taller* on the
 * very screens that are short — the row scales down uniformly.
 *
 * `zoom` (not `transform: scale`) is what does it: zoom scales layout, so the
 * chain re-wraps onto fewer lines as it shrinks and the deck below moves up.
 * Two consumers of the board's geometry survive it:
 * - CableLayer measures jacks in client px and feeds them to a viewBox built
 *   from the same client-space box, so the two cancel and the cables land.
 * - GSAP's Flip derives its matrices by probing live sibling elements
 *   (utils/matrix.js), which measures the effective zoom rather than assuming
 *   1 — but anything that copies a client rect into an inline px style has to
 *   divide it out itself (see useFlipReorder's lockRowHeights).
 *
 * Because the row wraps, height is not a simple ratio: halving the scale can
 * drop two lines at once, and where the lines break is a layout outcome. So the
 * fit is a binary search over *measured* heights rather than arithmetic on one
 * measurement — laid-out height is monotonic in the scale, which is all a
 * binary search needs.
 *
 * Stability: while fitting, the stage gets `data-fit`, which (board.css) hides
 * horizontal overflow and reserves the vertical scrollbar's gutter, so neither
 * scrollbar can appear or vanish as a side effect of a zoom change and move
 * the wrap width under the measurement. The hysteresis and hunt breaker above
 * are the backstop for anything else that feeds back.
 *
 * @param rowsRef  the `.board-rows` element (also useFlipReorder's scope)
 * @param orderKey re-fit when the chain changes: swapping an effect changes a
 *                 pedal's height, and reordering changes where lines break
 * @param enabled  off for the single-row (phone/small-tablet) board, which is
 *                 meant to be swiped through at full size
 */
export function useBoardFit(
  rowsRef: RefObject<HTMLDivElement | null>,
  orderKey: string,
  enabled: boolean,
) {
  const stageRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const rows = rowsRef.current;
    const stage = stageRef.current;
    if (!rows || !stage) return;
    if (!enabled) {
      rows.style.removeProperty('zoom');
      delete stage.dataset.fit;
      return;
    }
    stage.dataset.fit = '';

    let frame = 0;
    let current = 1;
    let lockedZoom: number | null = null;
    let lockedFor = '';
    let lastKey = '';
    let changes: { at: number; zoom: number }[] = [];

    const viewportKey = () => `${window.innerWidth}x${window.innerHeight}`;

    const apply = (zoom: number) => {
      if (zoom >= 1) rows.style.removeProperty('zoom');
      else rows.style.zoom = String(zoom);
      return rows.getBoundingClientRect().height;
    };

    const measure = () => {
      // Measure the unscaled board first: everything else in the stage (its
      // padding, the chassis frame, the floating deck) keeps its size when the
      // row shrinks, so that chrome comes off the height budget once and stays
      // off it.
      const naturalHeight = apply(1);
      const available = stage.clientHeight - (stage.scrollHeight - naturalHeight);
      if (available <= 0 || naturalHeight <= available) return 1;

      // Largest scale whose *laid-out* height still fits.
      let low = MIN_ZOOM;
      let high = 1;
      for (let i = 0; i < STEPS; i++) {
        const mid = (low + high) / 2;
        if (apply(mid) <= available) low = mid;
        else high = mid;
      }

      // Quantise down: sub-pixel jitter would otherwise write a new zoom on
      // every observer tick, and rounding up puts the board back over the edge
      // it was just fitted inside.
      const next = Math.max(MIN_ZOOM, Math.floor(low * 100) / 100);
      return next > NO_OP_ZOOM ? 1 : next;
    };

    const fit = () => {
      frame = 0;
      const key = viewportKey();
      if (lockedZoom !== null) {
        if (key === lockedFor) {
          apply(lockedZoom);
          return;
        }
        // the window moved: the lock was for the old size
        lockedZoom = null;
        changes = [];
      }

      let next = measure();
      // Hysteresis and the hunt count only apply while the window holds still:
      // a real resize should track the window exactly.
      const settled = key === lastKey;
      if (!settled) changes = [];
      lastKey = key;
      // A small regrow at a fixed window size is what a feedback loop looks
      // like; hold the current size.
      if (settled && next > current && next < 1 && next - current < GROW_HYSTERESIS) next = current;

      if (next !== current) {
        const now = performance.now();
        changes = changes.filter((c) => now - c.at < HUNT_WINDOW_MS);
        changes.push({ at: now, zoom: next });
        if (changes.length > HUNT_CHANGES) {
          lockedZoom = Math.min(current, ...changes.map((c) => c.zoom));
          lockedFor = key;
          next = lockedZoom;
        }
      }
      current = next;
      apply(next);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };

    fit();
    // The stage is the box being fitted into; the rows are what changes height
    // when an effect swap loads a taller pedal.
    const observer = new ResizeObserver(schedule);
    observer.observe(stage);
    observer.observe(rows);
    window.addEventListener('resize', schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      rows.style.removeProperty('zoom');
      delete stage.dataset.fit;
    };
  }, [rowsRef, orderKey, enabled]);

  return { stageRef };
}
