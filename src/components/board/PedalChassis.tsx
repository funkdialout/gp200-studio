/**
 * Per-template enclosure art for a board pedal (docs/board-design-system.md).
 *
 * Pedal.tsx owns the controls, footswitch and every interactive hit area; this
 * file only adds what makes the block look like the hardware it models: the
 * tolex behind an amp head, a cab's grille and speakers, a tape machine's reels.
 * Everything here is aria-hidden decoration and never takes a pointer event, so
 * none of it can move a control or steal a drag.
 *
 * Two pieces:
 *  - ChassisSkin: an absolutely positioned layer painted *behind* the pedal's
 *    content (the pedal is `isolation: isolate`, the skin `z-index: -1`).
 *  - ChassisFace: in-flow panels placed before or after the controls, which
 *    therefore take real height and push the name plate down.
 *
 * No text on any of it names a brand: the look is colour, proportion and layout
 * only. The spec `label` rides along in the manifest but is never printed.
 */
import { useId } from 'react';
import type { PedalLook, PedalTemplate } from './pedalManifest';
import { PATTERN_TILES, isPattern } from './patterns';
import { hexOf, shade } from './chassisLook';

/** Board-scale pattern tiles: the thumbnail weave, enlarged to read at pedal size. */
const TILE_SCALE = 1.6;

function SvgPattern({ id, kind, scale = TILE_SCALE }: { id: string; kind: string; scale?: number }) {
  const tile = PATTERN_TILES[kind];
  if (!tile) return null;
  const transform = `scale(${scale})${tile.rotate ? ` rotate(${tile.rotate})` : ''}`;
  return (
    <pattern
      id={id}
      width={tile.w}
      height={tile.h}
      patternUnits="userSpaceOnUse"
      patternTransform={transform}
      dangerouslySetInnerHTML={{ __html: tile.body }}
    />
  );
}

/** A full-bleed patterned fill (tolex, grille cloth, diamond-plate panel). */
function PatternFill({ kind, className }: { kind: string; className: string }) {
  const id = `pat-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className={className} aria-hidden="true" focusable="false">
      <defs>
        <SvgPattern id={id} kind={kind} />
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/* ── skin: behind the content ─────────────────────────────────────────── */

const SKINNED: ReadonlySet<PedalTemplate> = new Set(['amp', 'cab', 'rack', 'rocker', 'eq', 'tape', 'acoustic']);

export function ChassisSkin({ look }: { look: PedalLook }) {
  if (!SKINNED.has(look.template)) return null;
  const covered = (look.template === 'amp' || look.template === 'cab') && isPattern(look.tolex);
  return (
    <span className="chassis" aria-hidden="true">
      <span className="chassis-skin">
        {covered && <PatternFill kind={look.tolex!} className="chassis-tolex" />}
      </span>
      {look.template === 'amp' && <span className="amp-handle" />}
      {look.template === 'rack' && (
        <>
          <span className="rack-ear left"><i /><i /></span>
          <span className="rack-ear right"><i /><i /></span>
        </>
      )}
      {look.template === 'rocker' && <span className="rocker-toe" />}
    </span>
  );
}

/* ── faces: in-flow panels ─────────────────────────────────────────────── */

interface FaceProps {
  look: PedalLook;
  enabled: boolean;
  wide: boolean;
}

/** A 1U-style readout with the spec's display text, lit when the effect is on. */
function RackDisplay({ look }: FaceProps) {
  return (
    <div className="rack-display" aria-hidden="true">
      <span className="rd-screen">{look.display ?? '00'}</span>
      <span className="rd-vents" />
    </div>
  );
}

/** Amp grille strip under the control panel. */
function AmpGrille({ look }: FaceProps) {
  return (
    <div className="amp-grille" aria-hidden="true">
      <PatternFill kind={look.grille ?? 'blackweave'} className="grille-cloth" />
    </div>
  );
}

/** Height of a cab's grille, in px, from its speaker grid. */
function cabGrilleHeight(cols: number, rows: number, width: number): number {
  const cell = width / cols;
  // cap each speaker so a 4×12 or an 8×10 fridge doesn't tower over the row
  const maxCell = rows >= 3 ? 30 : rows === 2 ? 50 : 76;
  return Math.round(Math.min(cell, maxCell) * rows + 8);
}

function CabGrille({ look, wide }: FaceProps) {
  const cols = Math.max(1, look.cols ?? 1);
  const rows = Math.max(1, look.rows ?? 1);
  const width = wide ? 286 : 148;
  const height = cabGrilleHeight(cols, rows, width);
  const id = `cab-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const cellW = width / cols;
  const cellH = (height - 8) / rows;
  const r = Math.min(cellW, cellH) * 0.43;
  const speakers = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cx = cellW * (x + 0.5);
      const cy = 4 + cellH * (y + 0.5);
      speakers.push(
        <g key={`${x}-${y}`}>
          <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-cone)`} opacity={look.exposed ? 1 : 0.62} />
          {/* the baffle cut-out: a light rim reads on dark cloth, the dark edge on light */}
          <circle cx={cx} cy={cy} r={r + 1.2} fill="none" stroke="rgba(255,255,255,.16)" strokeWidth={1} />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth={1.5} />
          <circle cx={cx} cy={cy} r={r * 0.74} fill="none" stroke="rgba(255,255,255,.2)" strokeWidth={1} />
          <circle
            cx={cx}
            cy={cy}
            r={r * 0.3}
            fill={look.cone ?? '#1e1e20'}
            opacity={look.cone ? 0.85 : look.exposed ? 1 : 0.7}
            stroke="rgba(255,255,255,.12)"
            strokeWidth={0.8}
          />
        </g>,
      );
    }
  }
  return (
    <div className="cab-grille" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        <defs>
          <SvgPattern id={`${id}-cloth`} kind={look.grille ?? 'blackweave'} />
          <radialGradient id={`${id}-cone`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="rgba(0,0,0,.35)" />
            <stop offset="0.7" stopColor="rgba(0,0,0,.72)" />
            <stop offset="1" stopColor="rgba(0,0,0,.9)" />
          </radialGradient>
        </defs>
        <rect width={width} height={height} rx={4} fill={`url(#${id}-cloth)`} />
        {speakers}
      </svg>
      {look.size && <span className="cab-size">{look.size}</span>}
    </div>
  );
}

/** Instrument body outlines (the same curves tplAcoustic draws), centred on x 0. */
function acousticPath(shape: string | undefined): string {
  switch (shape) {
    case 'jumbo':
      return 'M 0 8 C 14 8 17 16 15 22 C 13.5 26 15 28 18 32 C 21 37 19 50 0 52 C -19 50 -21 37 -18 32 C -15 28 -13.5 26 -15 22 C -17 16 -14 8 0 8 Z';
    case 'om':
      return 'M 0 10 C 11 10 14 17 12 23 C 10.5 27 12 29 14.5 33 C 17 38 15 50 0 52 C -15 50 -17 38 -14.5 33 C -12 29 -10.5 27 -12 23 C -14 17 -11 10 0 10 Z';
    case 'mandolin':
      return 'M 0 14 C 10 14 15 24 13 34 C 11 46 6 50 0 50 C -6 50 -11 46 -13 34 C -15 24 -10 14 0 14 Z';
    case 'doublebass':
      return 'M 0 8 C 11 8 13 14 11 19 C 9 24 10 26 14 30 C 18 35 16 49 0 52 C -16 49 -18 35 -14 30 C -10 26 -9 24 -11 19 C -13 14 -11 8 0 8 Z';
    default: // dread / classical / fretless
      return 'M 0 9 C 13 9 15 16 13.5 22 C 12.5 26 13.5 28 16 32 C 18.5 37 17 50 0 52 C -17 50 -18.5 37 -16 32 C -13.5 28 -12.5 26 -13.5 22 C -15 16 -13 9 0 9 Z';
  }
}

function AcousticBody({ look }: FaceProps) {
  const id = `ac-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const bass = look.shape === 'doublebass';
  const wood = hexOf(look.wood, '#d9a95e');
  return (
    <div className="acoustic-body" aria-hidden="true">
      <svg viewBox="-26 0 52 56" height="100%" width="100%">
        <defs>
          <radialGradient id={id} cx=".38" cy=".32" r=".85">
            <stop offset="0" stopColor={shade(wood, 0.18)} />
            <stop offset="1" stopColor={shade(wood, -0.25)} />
          </radialGradient>
        </defs>
        {/* neck stub */}
        <rect x={bass ? -1.4 : -4} y={0} width={bass ? 2.8 : 8} height={bass ? 24 : 14} fill="#3a2410" />
        <path
          d={acousticPath(look.shape)}
          fill={`url(#${id})`}
          stroke={shade(wood, -0.5)}
          strokeWidth={1}
        />
        {bass ? (
          <>
            <path d="M -8 28 C -10 33 -7 38 -8.5 42" fill="none" stroke="#1a0e06" strokeWidth={1.6} strokeLinecap="round" />
            <path d="M 8 28 C 10 33 7 38 8.5 42" fill="none" stroke="#1a0e06" strokeWidth={1.6} strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx={0} cy={31} r={7.8} fill="none" stroke={shade(wood, -0.42)} strokeWidth={1.4} />
            <circle cx={0} cy={31} r={6.5} fill="#20130a" />
            <rect x={-8} y={43} width={16} height={3.4} rx={1.4} fill="#241408" />
          </>
        )}
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1={-3 + i * 2}
            y1={2}
            x2={-3 + i * 2}
            y2={bass ? 46 : 43}
            stroke="rgba(255,240,210,.55)"
            strokeWidth={0.35}
          />
        ))}
      </svg>
    </div>
  );
}

/** Tape machine deck: two reels (or an echo drum) and a VU meter (two when wide). */
function TapeDeck({ look, enabled, wide }: FaceProps) {
  const drum = look.kind === 'drum';
  // drawn in CSS pixels (the deck's own box, see .tape-deck) so circles stay round
  const W = wide ? 292 : 154;
  const H = wide ? 80 : 64;
  const cy = H / 2;
  const R = H * 0.36;
  const reelA = 10 + R;
  const reelB = reelA + 2 * R + (wide ? 22 : 8);
  // the needle rests on the stop peg while bypassed and sits up in the scale
  // while running; a transition, not an animation
  const needle = enabled ? 12 : -38;
  const reel = (cx: number) => (
    <g key={cx}>
      <circle cx={cx} cy={cy} r={R} fill="#161618" stroke="#6a6a6e" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={R * 0.65} fill="none" stroke="#2c2c30" strokeWidth={R * 0.25} />
      {[0, 1, 2].map((i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={cx + Math.cos((i * 2 * Math.PI) / 3 - Math.PI / 2) * R * 0.85}
          y2={cy + Math.sin((i * 2 * Math.PI) / 3 - Math.PI / 2) * R * 0.85}
          stroke="#5a5a5e"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ))}
      <circle cx={cx} cy={cy} r={R * 0.25} fill="#9a9aa0" stroke="#333" strokeWidth={0.8} />
    </g>
  );
  const vuW = H * 0.72;
  const vuH = H * 0.56;
  const vu = (x: number) => {
    const px = x + vuW / 2;
    const py = cy + vuH / 2 - 4;
    const arc = vuW * 0.36;
    return (
      <g key={x}>
        <rect x={x} y={cy - vuH / 2} width={vuW} height={vuH} rx={3} fill="#f2e8c8" stroke="rgba(0,0,0,.55)" strokeWidth={1} />
        <path d={`M ${px - arc} ${py - 4} A ${arc} ${arc} 0 0 1 ${px + arc} ${py - 4}`} fill="none" stroke="#6a5a3a" strokeWidth={1} />
        <path
          d={`M ${px + arc * 0.5} ${py - 4 - arc * 0.8} A ${arc} ${arc} 0 0 1 ${px + arc} ${py - 4}`}
          fill="none"
          stroke="#b03020"
          strokeWidth={2.2}
        />
        <line
          className="vu-needle"
          x1={px}
          y1={py}
          x2={px}
          y2={py - arc - 2}
          stroke="#1c1712"
          strokeWidth={1.2}
          strokeLinecap="round"
          style={{ transform: `rotate(${needle}deg)`, transformOrigin: `${px}px ${py}px` }}
        />
      </g>
    );
  };
  return (
    <div className="tape-deck" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
        <rect x={0} y={0} width={W} height={H} rx={4} fill={hexOf(look.panel, '#2a3630')} />
        {drum ? (
          <g>
            <circle cx={reelA + R * 0.3} cy={cy} r={R * 1.05} fill="#101010" stroke="#c9a850" strokeWidth={2.4} />
            <circle cx={reelA + R * 0.3} cy={cy} r={R * 0.42} fill="#c9a850" />
            {[0, 1, 2, 3].map((i) => {
              const a = ((-60 + i * 40) * Math.PI) / 180;
              const hx = reelA + R * 0.3 + Math.cos(a) * R * 1.35;
              return <rect key={i} x={hx - 2.5} y={cy + Math.sin(a) * R * 1.35 - 2.5} width={5} height={5} rx={1} fill="#e8d8a0" />;
            })}
          </g>
        ) : (
          <>
            <line x1={reelA} y1={cy - R} x2={reelB} y2={cy - R} stroke="#3a3a3c" strokeWidth={2} />
            {reel(reelA)}
            {reel(reelB)}
          </>
        )}
        {vu(W - vuW - 10)}
        {wide && vu(W - 2 * vuW - 18)}
      </svg>
    </div>
  );
}

/**
 * The in-flow panels of a template. `before` sits between the top chips and
 * the controls, `after` directly under the controls.
 */
export function ChassisFace({ where, ...props }: FaceProps & { where: 'before' | 'after' }) {
  const { template } = props.look;
  if (where === 'before') {
    if (template === 'cab') return <CabGrille {...props} />;
    if (template === 'acoustic') return <AcousticBody {...props} />;
    if (template === 'tape') return <TapeDeck {...props} />;
    if (template === 'rack') return <RackDisplay {...props} />;
    return null;
  }
  if (template === 'amp' && props.look.face !== 'panelfull') return <AmpGrille {...props} />;
  return null;
}
