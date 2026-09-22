/**
 * Resolves how a slot is drawn on the board: an amp head, a speaker cabinet,
 * a rocker treadle or a stompbox (docs: amp/cab realism).
 *
 * The *form* is keyed to the slot's module, not the manifest, so it is known
 * before the manifest loads and never changes when an effect is swapped (the
 * bay stays put). The manifest's `look` only refines the finish: tolex, grille
 * cloth, panel, speaker count, enclosure shape. public/sw.js serves
 * manifest.json stale-while-revalidate, so an entry without `look` must still
 * render sensibly from `colors` alone.
 */
import type { CSSProperties } from 'react';
import type { PedalArtEntry } from './pedalManifest';

export type BoardForm = 'amp' | 'cab' | 'rocker' | 'stomp';

export interface BoardLook {
  form: BoardForm;
  /** extra classes for the article: finish patterns + enclosure shape */
  classes: string[];
  /** CSS custom properties for solid-color finishes */
  vars: CSSProperties;
  /** cab speaker grid */
  cols: number;
  rows: number;
  /** cab size badge, e.g. "2×12" (empty when unknown) */
  size: string;
}

/** tolex / cloth patterns drawn in CSS; anything else is a solid hex */
const TOLEX_PATTERNS = new Set(['tweed', 'orangeweave', 'bluecheck']);
const GRILLES = new Set([
  'blackweave', 'metalgrid', 'silverface', 'wheat', 'cane', 'oxblood', 'basket', 'diamond',
]);
const SHAPES = new Set(['std', 'big', 'mxr', 'round']);

const isHex = (c: string | undefined): c is string => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c);

export function formForModule(module: string, art?: PedalArtEntry): BoardForm {
  if (module === 'AMP') return 'amp';
  if (module === 'CAB') return 'cab';
  if (module === 'WAH' || module === 'VOL') return 'rocker';
  // a treadle living in another module (PRE Hammy) still rocks
  if (art?.look?.kind === 'rocker') return 'rocker';
  return 'stomp';
}

function tolex(value: string | undefined, fallback: string, classes: string[], vars: Record<string, string>) {
  if (value && TOLEX_PATTERNS.has(value)) {
    classes.push(`tolex-${value}`);
  } else {
    classes.push('tolex-solid');
    vars['--tolex'] = isHex(value) ? value : fallback;
  }
}

function grille(value: string | undefined, classes: string[]) {
  classes.push(`grille-${value && GRILLES.has(value) ? value : 'blackweave'}`);
}

export function resolveLook(module: string, art?: PedalArtEntry): BoardLook {
  const form = formForModule(module, art);
  const classes: string[] = [`form-${form}`];
  const vars: Record<string, string> = {};
  const look = art?.look;
  const body = art?.colors?.body ?? '#1c1c1e';
  let cols = 1;
  let rows = 1;
  let size = '';

  if (form === 'amp') {
    const a = look?.kind === 'amp' ? look : undefined;
    tolex(a?.tolex, body, classes, vars);
    grille(a?.grille, classes);
    if (a?.panel === 'diamondplate') classes.push('panel-plate');
    if (a?.piping) vars['--piping'] = a.piping;
    else classes.push('no-piping');
    if (a?.lamp) vars['--lamp'] = a.lamp;
  } else if (form === 'cab') {
    const c = look?.kind === 'cab' ? look : undefined;
    if (c) {
      tolex(c.tolex, body, classes, vars);
      grille(c.grille, classes);
      if (c.piping) vars['--piping'] = c.piping;
      else classes.push('no-piping');
      cols = Math.max(1, Math.min(4, c.cols));
      rows = Math.max(1, Math.min(4, c.rows));
      size = c.size;
    } else {
      // acoustic IRs and pre-`look` manifests: a plain 1-speaker box in the
      // entry's body color (wood for acoustics)
      if (look?.kind === 'acoustic') classes.push('cab-acoustic');
      tolex(undefined, body, classes, vars);
      grille(look?.kind === 'acoustic' ? 'wheat' : 'blackweave', classes);
      classes.push('no-piping');
    }
    vars['--cols'] = String(cols);
    vars['--rows'] = String(rows);
  } else if (form === 'stomp') {
    const shape = look?.kind === 'stomp' && SHAPES.has(look.shape) ? look.shape : 'std';
    classes.push(`shape-${shape}`);
  }

  return { form, classes, vars: vars as CSSProperties, cols, rows, size };
}
