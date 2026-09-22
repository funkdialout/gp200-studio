import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formForModule, resolveLook } from '@/components/board/pedalLook';
import type { PedalArtEntry } from '@/components/board/pedalManifest';

const manifest: PedalArtEntry[] = JSON.parse(
  readFileSync(join(process.cwd(), 'public/pedals/manifest.json'), 'utf8'),
);
const entry = (module: string, name: string) => manifest.find((e) => e.module === module && e.name === name)!;

describe('formForModule', () => {
  it('keys the form to the slot module, so it is known before the manifest loads', () => {
    expect(formForModule('AMP')).toBe('amp');
    expect(formForModule('CAB')).toBe('cab');
    expect(formForModule('WAH')).toBe('rocker');
    expect(formForModule('VOL')).toBe('rocker');
    expect(formForModule('DST')).toBe('stomp');
  });

  it('lets a treadle in another module rock', () => {
    expect(formForModule('PRE', entry('PRE', 'Hammy'))).toBe('rocker');
  });
});

describe('resolveLook', () => {
  it('draws amps with their tolex, grille and panel finish', () => {
    const look = resolveLook('AMP', entry('AMP', 'Mess DualV'));
    expect(look.form).toBe('amp');
    expect(look.classes).toEqual(expect.arrayContaining(['form-amp', 'grille-metalgrid', 'panel-plate']));
  });

  it('uses pattern tolex classes and solid colors as a CSS var', () => {
    const tweed = resolveLook('AMP', entry('AMP', 'Tweedy'));
    expect(tweed.classes).toContain('tolex-tweed');
    const uk = resolveLook('AMP', entry('AMP', 'UK 800'));
    expect(uk.classes).toContain('tolex-solid');
    expect(uk.vars).toHaveProperty('--tolex');
    expect(uk.vars).toHaveProperty('--piping');
  });

  it('gives cabs their speaker grid', () => {
    const look = resolveLook('CAB', entry('CAB', 'Dark Twin'));
    expect([look.cols, look.rows, look.size]).toEqual([2, 1, '2×12']);
  });

  it('falls back to a plain box for a pre-`look` manifest entry', () => {
    const { look: _look, ...old } = entry('CAB', 'Dark Twin');
    const look = resolveLook('CAB', old);
    expect(look.form).toBe('cab');
    expect([look.cols, look.rows]).toEqual([1, 1]);
    expect(look.classes).toEqual(expect.arrayContaining(['tolex-solid', 'grille-blackweave']));
    expect(resolveLook('AMP').form).toBe('amp');
  });

  it('carries the stompbox enclosure shape', () => {
    const shapes = manifest
      .filter((e) => e.look?.kind === 'stomp')
      .map((e) => resolveLook(e.module, e).classes.find((c) => c.startsWith('shape-')));
    expect(new Set(shapes)).toEqual(new Set(['shape-std', 'shape-big', 'shape-mxr', 'shape-round']));
  });
});

describe('generated manifest look data', () => {
  it('every amp-head and cab entry carries a look', () => {
    for (const e of manifest.filter((m) => m.module === 'AMP' || m.module === 'CAB')) {
      expect(e.look, `${e.module}::${e.name}`).toBeDefined();
    }
    expect(manifest.filter((e) => e.look?.kind === 'amp').length).toBeGreaterThan(40);
    expect(manifest.filter((e) => e.look?.kind === 'cab').length).toBeGreaterThan(40);
  });
});
