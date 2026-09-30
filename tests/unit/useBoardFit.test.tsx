import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardFit } from '@/components/board/useBoardFit';

/**
 * jsdom has no layout, so the rows' height is a function we control of the
 * zoom the hook writes, and the stage's height budget is fixed.
 */
function setup(heightAt: (zoom: number) => number) {
  const stage = document.createElement('main');
  const rows = document.createElement('div');
  stage.appendChild(rows);
  document.body.appendChild(stage);
  const zoomOf = () => Number(rows.style.zoom || 1);
  rows.getBoundingClientRect = () => ({ height: heightAt(zoomOf()) }) as DOMRect;
  Object.defineProperty(stage, 'clientHeight', { configurable: true, get: () => 500 });
  // 100px of chrome (padding, deck) around the rows
  Object.defineProperty(stage, 'scrollHeight', { configurable: true, get: () => heightAt(zoomOf()) + 100 });
  return { stage, rows, zoomOf };
}

let observerCallbacks: (() => void)[] = [];
let frames: FrameRequestCallback[] = [];

/** Deliver a ResizeObserver tick and run the frame it schedules, like a browser would. */
function tick() {
  observerCallbacks.forEach((cb) => cb());
  const due = frames;
  frames = [];
  due.forEach((cb) => cb(0));
}

beforeEach(() => {
  observerCallbacks = [];
  frames = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        observerCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function mount(els: ReturnType<typeof setup>) {
  // one stable ref object, as a component's useRef would give
  const rowsRef = { current: els.rows };
  return renderHook(() => {
    const fit = useBoardFit(rowsRef, 'k', true);
    // attach during render so the layout effect sees the stage
    fit.stageRef.current = els.stage;
    return fit;
  });
}

describe('useBoardFit', () => {
  it('shrinks the board to the largest zoom that fits the stage', () => {
    // 400px budget: a 500px board fits at 0.8
    const els = setup((z) => 500 * z);
    mount(els);
    tick();
    expect(els.zoomOf()).toBe(0.8);
    expect(els.stage.dataset.fit).toBe('');
  });

  it('never shrinks below the readable floor', () => {
    const els = setup((z) => 800 * z);
    mount(els);
    tick();
    expect(els.zoomOf()).toBe(0.68);
  });

  it('stops hunting when a zoom change feeds back into the measurement', () => {
    // The board measures 60px taller on alternate frames (a scrollbar or a
    // re-wrap toggled by the previous zoom), so the ideal zoom alternates.
    let flip = false;
    const els = setup((z) => (flip ? 520 : 460) * z);
    mount(els);
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      flip = !flip;
      tick();
      if (i >= 10) seen.add(els.zoomOf());
    }
    // after the breaker trips the zoom holds one value, the smaller one
    expect([...seen]).toEqual([Math.min(...seen)]);
    expect(els.zoomOf()).toBeLessThan(0.8);
  });

  it('tracks a real window resize after locking', () => {
    let flip = false;
    const els = setup((z) => (flip ? 520 : 460) * z);
    mount(els);
    for (let i = 0; i < 10; i++) {
      flip = !flip;
      tick();
    }
    const locked = els.zoomOf();
    // window grows: the lock is released and the board re-fits
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: window.innerWidth + 200 });
    flip = false;
    tick();
    expect(els.zoomOf()).not.toBe(locked);
  });
});
