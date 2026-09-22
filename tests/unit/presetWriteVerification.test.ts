import { describe, expect, it } from 'vitest';
import { createDefaultPreset } from '@/core/defaultPreset';
import { defaultExpAssignments } from '@/core/controlRecords';
import { expressionAssignmentMismatch, presetWriteMismatch } from '@/core/presetWriteVerification';

describe('presetWriteMismatch', () => {
  it('accepts a matching readback with harmless float rounding', () => {
    const wanted = createDefaultPreset();
    wanted.effects[0].params[0] = 12.5;
    const actual = structuredClone(wanted);
    actual.effects[0].params[0] = 12.501;
    expect(presetWriteMismatch(wanted, actual)).toBeNull();
  });

  it('detects a silently discarded import even if the name stayed the same', () => {
    const wanted = createDefaultPreset();
    const actual = structuredClone(wanted);
    actual.effects[0].effectId ^= 1;
    expect(presetWriteMismatch(wanted, actual)).toContain('different model');
  });

  it('ignores unused float slots that the pedal can reset on an effect change', () => {
    const wanted = createDefaultPreset();
    const actual = structuredClone(wanted);
    actual.effects[0].params[14] = 99;
    expect(presetWriteMismatch(wanted, actual)).toBeNull();
  });

  it('reports the expected and actual EXP target after readback', () => {
    const wanted = createDefaultPreset();
    wanted.expAssignments = defaultExpAssignments();
    const actual = structuredClone(wanted);
    actual.expAssignments![0].blockIndex = null;
    expect(presetWriteMismatch(wanted, actual)).toBeNull();
    expect(expressionAssignmentMismatch(wanted, actual)).toContain('wanted block 10, parameter 0; read unassigned');
  });

  it('reports an EXP range retained from the overwritten slot', () => {
    const wanted = createDefaultPreset();
    wanted.expAssignments = defaultExpAssignments();
    const actual = structuredClone(wanted);
    actual.expAssignments![0].max = 85;
    expect(expressionAssignmentMismatch(wanted, actual)).toContain('range differs');
  });

  it('detects stale names, styles, parameters and footswitch assignments', () => {
    const wanted = createDefaultPreset();
    wanted.ctrlAssignments = [{ ctrlIndex: 0, blockMask: 1 }];
    const actual = structuredClone(wanted);
    actual.patchName = 'Old Patch';
    expect(presetWriteMismatch(wanted, actual)).toContain('name');
    actual.patchName = wanted.patchName;
    actual.patchStyle = 8;
    expect(presetWriteMismatch(wanted, actual)).toContain('style');
    actual.patchStyle = wanted.patchStyle;
    actual.effects[0].params[0] += 5;
    expect(presetWriteMismatch(wanted, actual)).toContain('parameter');
    actual.effects[0].params[0] = wanted.effects[0].params[0];
    actual.ctrlAssignments![0].blockMask = 2;
    expect(presetWriteMismatch(wanted, actual)).toContain('footswitch');
  });
});
