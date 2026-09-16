import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { Pedal } from '@/components/board/Pedal';
import { buildManifestIndex, lookupPedalArt, type PedalArtEntry } from '@/components/board/pedalManifest';
import type { EffectSlot } from '@/core/types';
import { EFFECT_MAP } from '@/core/effectNames';

const manifest: PedalArtEntry[] = JSON.parse(
  readFileSync(join(process.cwd(), 'public/pedals/manifest.json'), 'utf8'),
);
const index = buildManifestIndex(manifest);

// slot = physical block (SLOT_MODULES order), effectId from EFFECT_MAP
const SLOTS = { PRE: 0, WAH: 1, DST: 2, AMP: 3, CAB: 5, DLY: 8 } as const;

function renderPedal(slotIndex: number, effectId: number, enabled = true) {
  const slot: EffectSlot = { slotIndex, effectId, enabled, params: Array(15).fill(50) };
  const onToggle = vi.fn();
  const utils = render(
    <Pedal
      slot={slot}
      index={0}
      art={lookupPedalArt(index, effectId)}
      onToggle={onToggle}
      onOpenPicker={vi.fn()}
      onParamChange={vi.fn()}
      onDragStart={vi.fn()}
      onMove={vi.fn()}
      onInspect={vi.fn()}
      onPin={vi.fn()}
      isPinned={false}
      chainLength={11}
    />,
  );
  const pedal = utils.container.querySelector('article.pedal')!;
  return { ...utils, pedal, onToggle };
}

describe('board chassis templates', () => {
  it('draws an amp head: panel of knobs, grille strip, wide in its wide bay', () => {
    const { pedal } = renderPedal(SLOTS.AMP, 117440516); // AMP Dark Twin
    expect(pedal.className).toContain('tpl-amp');
    expect(pedal.className).toContain('wide');
    expect(pedal.querySelector('.controls.amp-panel .knob')).not.toBeNull();
    expect(pedal.querySelector('.amp-grille pattern')).not.toBeNull();
    expect(pedal.querySelector('.amp-handle')).not.toBeNull();
  });

  it('draws a cab: grille with its speaker grid and size tag, knobs on a back plate', () => {
    const { pedal } = renderPedal(SLOTS.CAB, 167772178); // CAB Dark Twin, 2×12
    expect(pedal.className).toContain('tpl-cab');
    // each speaker is a group of circles inside the grille svg
    expect(pedal.querySelectorAll('.cab-grille svg > g')).toHaveLength(2);
    expect(pedal.querySelector('.cab-size')?.textContent).toBe('2×12');
    expect(pedal.querySelector('.controls.back-plate .knob')).not.toBeNull();
  });

  it('gives rockers a treadle and the squat enclosure a round stomp', () => {
    const wah = renderPedal(SLOTS.WAH, lookupId('WAH', 'C-Wah'));
    expect(wah.pedal.className).toContain('tpl-rocker');
    expect(wah.pedal.querySelector('.treadle')).not.toBeNull();
    const boost = renderPedal(SLOTS.PRE, lookupId('PRE', 'Micro Boost'));
    expect(boost.pedal.className).toContain('shape-mxr');
    expect(boost.pedal.querySelector('.stomp-round')).not.toBeNull();
    expect(boost.pedal.querySelector('.treadle')).toBeNull();
  });

  it('draws tape machines and racks with their own faces', () => {
    const tape = renderPedal(SLOTS.DLY, lookupId('DLY', 'Tape'));
    expect(tape.pedal.className).toContain('tpl-tape');
    expect(tape.pedal.querySelector('.tape-deck svg')).not.toBeNull();
    const rack = renderPedal(SLOTS.DLY, lookupId('DLY', '999 Echo'));
    expect(rack.pedal.className).toContain('tpl-rack');
    expect(rack.pedal.querySelector('.rd-screen')?.textContent).toBe('999');
  });

  it('keeps the footswitch toggle and bypass tag on every template', () => {
    const { pedal, onToggle } = renderPedal(SLOTS.CAB, 167772178, false);
    expect(pedal.className).toContain('bypassed');
    expect(pedal.querySelector('.p-off-tag')?.textContent).toBe('BYPASSED');
    fireEvent.click(pedal.querySelector('.treadle, .stomp-round')!);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('draws the old stompbox when the manifest predates `look`', () => {
    const art = lookupPedalArt(index, 117440516)!;
    const { look: _look, ...stale } = art;
    const slot: EffectSlot = { slotIndex: SLOTS.AMP, effectId: 117440516, enabled: true, params: Array(15).fill(50) };
    const { container } = render(
      <Pedal
        slot={slot}
        index={0}
        art={stale}
        onToggle={vi.fn()}
        onOpenPicker={vi.fn()}
        onParamChange={vi.fn()}
        onDragStart={vi.fn()}
        onMove={vi.fn()}
        onInspect={vi.fn()}
        onPin={vi.fn()}
        isPinned={false}
        chainLength={11}
      />,
    );
    const pedal = container.querySelector('article.pedal')!;
    expect(pedal.className).toContain('tpl-stomp');
    // the panel colour still gives it the amp strip it always had
    expect(pedal.querySelector('.controls.amp-panel')).not.toBeNull();
    expect(pedal.querySelector('.amp-grille')).toBeNull();
  });

  it('prints no spec label (model shorthand) anywhere on the pedal', () => {
    const { pedal } = renderPedal(SLOTS.AMP, lookupId('AMP', 'UK 800'));
    // the caption's "Based on" line is the one place the real hardware is named
    expect(pedal.querySelector('.p-desc')?.textContent).toContain('JCM800');
    expect(pedal.textContent).not.toContain('JCM·800');
  });
});

function lookupId(module: string, name: string): number {
  const hit = Object.entries(EFFECT_MAP).find(([, e]) => e.module === module && e.name === name);
  if (!hit) throw new Error(`no effect id for ${module}:${name}`);
  return Number(hit[0]);
}
