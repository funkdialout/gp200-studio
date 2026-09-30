import { describe, it, expect } from 'vitest';
import { cycleCandidates, stepEffect } from '@/core/effectCycle';
import { getEffectsByModule } from '@/core/effectNames';

const IR_BASE = 0x0a100000;
const noNames: string[] = [];

describe('cycleCandidates', () => {
  it('lists every effect of the module in ascending id (device) order', () => {
    const ids = cycleCandidates('DST', -1, noNames);
    expect(ids).toHaveLength(getEffectsByModule('DST').length);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  it('keeps all 20 User IR slots while IR names are unknown', () => {
    const ids = cycleCandidates('CAB', -1, noNames);
    for (let slot = 0; slot < 20; slot++) expect(ids).toContain(IR_BASE + slot);
  });

  it('puts User IRs after the built-in cabs', () => {
    const ids = cycleCandidates('CAB', -1, noNames);
    expect(ids[ids.length - 1]).toBe(IR_BASE + 19);
    expect(ids.indexOf(IR_BASE)).toBe(ids.length - 20);
  });

  it('skips empty User IR slots once names are known', () => {
    const names = Array<string>(20).fill('');
    names[2] = 'Mesa 4x12';
    names[7] = '  ';
    const ids = cycleCandidates('CAB', -1, names);
    expect(ids).toContain(IR_BASE + 2);
    expect(ids).not.toContain(IR_BASE + 0);
    expect(ids).not.toContain(IR_BASE + 7);
  });

  it('keeps the current effect even when it is an empty IR slot', () => {
    const names = Array<string>(20).fill('');
    expect(cycleCandidates('CAB', IR_BASE + 5, names)).toContain(IR_BASE + 5);
  });
});

describe('stepEffect', () => {
  const rvb = cycleCandidates('RVB', -1, noNames);

  it('steps forward and back', () => {
    expect(stepEffect('RVB', rvb[0], 1, noNames)).toBe(rvb[1]);
    expect(stepEffect('RVB', rvb[1], -1, noNames)).toBe(rvb[0]);
  });

  it('wraps at both ends', () => {
    expect(stepEffect('RVB', rvb[rvb.length - 1], 1, noNames)).toBe(rvb[0]);
    expect(stepEffect('RVB', rvb[0], -1, noNames)).toBe(rvb[rvb.length - 1]);
  });

  it('enters the list from an unmapped id', () => {
    expect(stepEffect('RVB', 0xdeadbeef, 1, noNames)).toBe(rvb[0]);
    expect(stepEffect('RVB', 0xdeadbeef, -1, noNames)).toBe(rvb[rvb.length - 1]);
  });

  it('moves from the last built-in cab to the first loaded IR, skipping empties', () => {
    const names = Array<string>(20).fill('');
    names[3] = 'Loaded';
    const builtIns = cycleCandidates('CAB', -1, names).filter((id) => id < IR_BASE);
    expect(stepEffect('CAB', builtIns[builtIns.length - 1], 1, names)).toBe(IR_BASE + 3);
    expect(stepEffect('CAB', IR_BASE + 3, 1, names)).toBe(builtIns[0]);
  });

  it('returns null for an unknown module', () => {
    expect(stepEffect('NOPE', 1, 1, noNames)).toBeNull();
  });
});
