import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildManifestIndex, lookupPedalArt, type PedalArtEntry } from '@/components/board/pedalManifest';

const entries: PedalArtEntry[] = [
  { name: 'COMP', module: 'PRE', slug: 'comp', file: 'comp.svg', type: 'Compressor', basedOn: 'Ross™ Compressor', blurb: 'Evens out dynamics.' },
  { name: 'Tube', module: 'DST', slug: 'tube', file: 'tube--dst.svg', type: 'Overdrive', basedOn: 'BK Butler® Tube Driver', blurb: 'Tube drive.' },
  { name: 'Tube', module: 'DLY', slug: 'tube', file: 'tube--dly.svg', type: 'Delay', basedOn: 'Binson® Echorec', blurb: 'Drum echo.' },
];

describe('buildManifestIndex', () => {
  it('indexes by module + name so same-name effects stay distinct', () => {
    const index = buildManifestIndex(entries);
    expect(index.size).toBe(3);
    expect(index.get('DST::Tube')?.file).toBe('tube--dst.svg');
    expect(index.get('DLY::Tube')?.file).toBe('tube--dly.svg');
  });
});

describe('lookupPedalArt', () => {
  const index = buildManifestIndex(entries);

  it('finds art via the effect id (module + name join)', () => {
    // effectId 0 = COMP / PRE in EFFECT_MAP
    expect(lookupPedalArt(index, 0)?.file).toBe('comp.svg');
  });

  it('disambiguates the DST/DLY "Tube" collision', () => {
    expect(lookupPedalArt(index, 50331659)?.file).toBe('tube--dst.svg'); // DST Tube
    expect(lookupPedalArt(index, 184549387)?.file).toBe('tube--dly.svg'); // DLY Tube
  });

  it('returns undefined for effects without artwork and for a null index', () => {
    expect(lookupPedalArt(index, 26)).toBeUndefined(); // PRE Boost, not in fixture
    expect(lookupPedalArt(null, 0)).toBeUndefined();
  });
});

describe('generated manifest.json (public/pedals/)', () => {
  const manifest: PedalArtEntry[] = JSON.parse(
    readFileSync(join(process.cwd(), 'public/pedals/manifest.json'), 'utf8'),
  );

  it('every entry carries a full body-colors block with valid values', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    expect(manifest.length).toBeGreaterThan(250);
    for (const entry of manifest) {
      const c = entry.colors;
      expect(c, `${entry.module}::${entry.name} has no colors`).toBeDefined();
      expect(c!.body).toMatch(hex);
      expect(c!.bodyDeep).toMatch(hex);
      expect(c!.ink).toMatch(hex);
      expect(c!.led).toMatch(hex);
      expect(['dark', 'cream', 'gold']).toContain(c!.knob);
      if (c!.panel !== undefined) {
        expect(c!.panel).toMatch(hex);
        expect(c!.panelText).toMatch(hex);
      }
    }
  });

  it('amp-head effects carry a control-panel color, others never do', () => {
    // not all AMP-module effects are drawn as amp heads (bass preamps are
    // racks/stomps), but the bulk are, and only AMP entries may have a panel
    const withPanel = manifest.filter((e) => e.colors?.panel !== undefined);
    expect(withPanel.length).toBeGreaterThan(40);
    expect(withPanel.every((e) => e.module === 'AMP')).toBe(true);
    expect(manifest.find((e) => e.name === 'UK 800')?.colors?.panel).toBeDefined();
  });

  it('every entry carries a board `look` with a known template', () => {
    const templates = ['stomp', 'rocker', 'eq', 'amp', 'cab', 'acoustic', 'rack', 'tape', 'util'];
    for (const entry of manifest) {
      expect(templates, `${entry.module}::${entry.name}`).toContain(entry.look?.template);
    }
    const byName = (module: string, name: string) => manifest.find((e) => e.module === module && e.name === name)!;
    expect(byName('AMP', 'UK 800').look).toMatchObject({ template: 'amp', grille: 'blackweave', panel: '#b8933a' });
    expect(byName('CAB', 'UK GRN 2').look).toMatchObject({ template: 'cab', cols: 2, rows: 2, size: '4×12' });
    expect(byName('MOD', 'O-Phase').look).toMatchObject({ template: 'stomp', shape: 'mxr', plate: false });
  });

  it('resolves both halves of every slug collision to files that exist', () => {
    // Dark Twin (AMP/CAB), Tube (DST/DLY), SnapTone (AMP/DST) share a slug, so
    // their files carry a --module suffix. A URL built from `slug` alone is not
    // a file at all: the preview/SPA fallback answers it with HTML, which an
    // <img> shows as a broken image. Always go through `file` (pedalArtUrl).
    const index = buildManifestIndex(manifest);
    expect(lookupPedalArt(index, 117440516)?.file).toBe('dark-twin--amp.svg');
    expect(lookupPedalArt(index, 167772178)?.file).toBe('dark-twin--cab.svg');
    for (const entry of manifest) {
      expect(existsSync(join(process.cwd(), 'public/pedals', entry.file)), entry.file).toBe(true);
    }
    const slugs = new Map<string, number>();
    for (const e of manifest) slugs.set(e.slug, (slugs.get(e.slug) ?? 0) + 1);
    for (const e of manifest.filter((m) => (slugs.get(m.slug) ?? 0) > 1)) {
      expect(e.file).toBe(`${e.slug}--${e.module.toLowerCase()}.svg`);
    }
  });
});
