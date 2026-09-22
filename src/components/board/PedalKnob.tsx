import { useEffect, useId, useRef, useState } from 'react';
import type { KnobParam } from '@/core/effectParams';
import { KNOB_STYLES, type BodySpec } from './boardPalette';
import { clampSnap, formatValue } from './paramValue';
import { KNOB_VIEWBOX, keyStep, knobAngle, polar, tickPaths } from './knobGeometry';

/** Knurling on the knob skirt: short radial grooves, drawn once. */
const KNURL: string[] = Array.from({ length: 44 }, (_, i) => {
  const a = (360 * i) / 44;
  const [x0, y0] = polar(50, 50, 27.5, a);
  const [x1, y1] = polar(50, 50, 33.5, a);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`;
});

interface PedalKnobProps {
  param: KnobParam;
  value: number;
  onChange: (value: number) => void;
  knobStyle: BodySpec['knob'];
  ink: string;
  /** for the accessible label, e.g. "UK 800 Gain" */
  pedalName: string;
}

/** pixels of vertical drag for a full min→max sweep (mockup-tested) */
const DRAG_RANGE_PX = 160;
/** Chrome's pixel delta for one mouse-wheel detent */
const WHEEL_NOTCH_DELTA = 100;
/** a violent flick shouldn't slam the param into its rail in one event */
const MAX_NOTCHES_PER_EVENT = 4;
const LINE_DELTA_PX = 16;
const PAGE_DELTA_PX = 400;

/** Wheel deltas in the event's own unit, normalised to pixels. */
function wheelPixels(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * LINE_DELTA_PX;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * PAGE_DELTA_PX;
  return event.deltaY;
}

/**
 * Skeuomorphic rotary knob: 270° sweep, vertical pointer drag, mouse wheel,
 * double-click reset, arrow-key steps. The pointer position IS the value.
 * No value arc.
 */
export function PedalKnob({ param, value, onChange, knobStyle, ink, pedalName }: PedalKnobProps) {
  const style = KNOB_STYLES[knobStyle];
  // per-instance gradient id (useId's punctuation isn't safe inside url(#…))
  const capId = `kcap${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ y: 0, value: 0 });
  const unitRef = useRef<HTMLDivElement>(null);

  const angle = knobAngle(value, param);
  const ticks = tickPaths();
  const step = keyStep(param);

  const nudge = (notches: number) => {
    const next = clampSnap(value + notches * step, param);
    if (next !== value) onChange(next);
  };
  // the wheel listener below is attached once, so it reads the live handler
  // through a ref rather than closing over a stale `value`.
  const nudgeRef = useRef(nudge);
  useEffect(() => {
    nudgeRef.current = nudge;
  });

  useEffect(() => {
    const unit = unitRef.current;
    if (!unit) return;
    // Leftover sub-notch scroll. A trackpad emits many tiny deltas that would
    // each round to zero on their own, so they bank here until they add up.
    let carried = 0;
    // On the whole unit, not the cap: the name and value are part of the same
    // control, and a wheel that dies the moment the pointer drifts onto the
    // label reads as broken. React also registers `onWheel` passively at the
    // root container, so preventDefault() from a JSX handler is a no-op and the
    // board scrolls behind the knob -- hence the native non-passive listener.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scrolled = -wheelPixels(event);
      if (scrolled === 0) return;
      // a reversal is a new gesture; banked delta from the old direction
      // would otherwise have to be paid off before the knob turned back.
      if (Math.sign(scrolled) !== Math.sign(carried)) carried = 0;
      carried += scrolled;
      const notches = Math.trunc(carried / WHEEL_NOTCH_DELTA);
      if (notches === 0) return;
      carried -= notches * WHEEL_NOTCH_DELTA;
      const capped = Math.max(-MAX_NOTCHES_PER_EVENT, Math.min(MAX_NOTCHES_PER_EVENT, notches));
      nudgeRef.current(capped);
    };
    unit.addEventListener('wheel', onWheel, { passive: false });
    return () => unit.removeEventListener('wheel', onWheel);
  }, []);

  return (
    // the pointer drag, the wheel and the double-click reset all live on the
    // unit rather than the cap: name and value are part of the same control,
    // and a gesture that dies when the pointer drifts 10px onto the label reads
    // as broken. The cap keeps the slider role, focus and arrow keys -- the
    // labels are static text and would only add duplicate a11y nodes.
    <div
      className={`knob${dragging ? ' dragging' : ''}`}
      ref={unitRef}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStart.current = { y: e.clientY, value };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const range = param.max - param.min;
        const travel = dragStart.current.y - e.clientY;
        const raw = dragStart.current.value + (travel * range) / DRAG_RANGE_PX;
        const next = clampSnap(raw, param);
        if (next !== value) onChange(next);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => onChange(param.default)}
    >
      <svg
        viewBox={`0 0 ${KNOB_VIEWBOX} ${KNOB_VIEWBOX}`}
        role="slider"
        tabIndex={0}
        aria-label={`${pedalName} ${param.name}`}
        aria-valuemin={param.min}
        aria-valuemax={param.max}
        aria-valuenow={Number(value.toFixed(param.step < 1 ? 1 : 0))}
        aria-valuetext={formatValue(value, param)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault();
            nudge(1);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            nudge(-1);
          }
        }}
      >
        {ticks.map((tick) => (
          <path
            key={tick}
            d={tick}
            stroke={ink}
            strokeOpacity={0.35}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}
        <defs>
          <radialGradient id={capId} cx="40%" cy="32%" r="75%">
            <stop offset="0" stopColor={style.cap0} />
            <stop offset="0.7" stopColor={style.cap1} />
            <stop offset="1" stopColor={style.cap1} stopOpacity={0.85} />
          </radialGradient>
        </defs>
        {/* contact shadow, knurled skirt, then the lit cap */}
        <circle cx={51} cy={54} r={34} fill="rgba(0,0,0,.32)" />
        <circle cx={50} cy={50} r={34} fill={style.cap1} />
        <path d={KNURL.join('')} stroke="rgba(0,0,0,.38)" strokeWidth={2.2} />
        <circle cx={50} cy={50} r={34} fill="none" stroke="rgba(0,0,0,.5)" strokeWidth={1.5} />
        <circle cx={50} cy={50} r={25} fill={`url(#${capId})`} />
        <circle cx={50} cy={50} r={25} fill="none" stroke="rgba(0,0,0,.35)" strokeWidth={1.2} />
        <ellipse cx={42} cy={39} rx={11} ry={7} fill="#fff" opacity={0.28} />
        <line
          x1={50}
          y1={48}
          x2={50}
          y2={20}
          stroke={style.pointer}
          strokeWidth={6}
          strokeLinecap="round"
          transform={`rotate(${angle} 50 50)`}
        />
      </svg>
      <span className="k-label" title={param.name}>{param.name}</span>
      <span className="k-value">{formatValue(value, param)}</span>
    </div>
  );
}
