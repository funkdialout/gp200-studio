import { describe, expect, it } from 'vitest';
import { createDefaultPreset } from '@/core/defaultPreset';
import { defaultExpAssignments } from '@/core/controlRecords';
import { EFFECT_PARAMS } from '@/core/effectParams';
import { writePresetLive } from '@/core/presetLiveWrite';
import { SysExCodec } from '@/core/SysExCodec';

describe('writePresetLive', () => {
  it('activates each block before parameters and commits the chosen slot', async () => {
    const preset = createDefaultPreset();
    preset.patchName = 'Imported';
    const messages: Uint8Array[] = [];
    await writePresetLive(preset, 37, (message) => messages.push(message), async () => {});

    expect(messages[0]).toEqual(SysExCodec.buildPresetChange(37));
    expect(messages[1]).toEqual(SysExCodec.buildEffectChange(0, preset.effects[0].effectId));
    expect(messages[2]).toEqual(SysExCodec.buildToggleEffect(0, true));
    expect(messages.at(-2)).toEqual(SysExCodec.buildSaveCommit('Imported', 37));
    expect(messages.at(-1)).toEqual(SysExCodec.buildPresetChange(37));
  });

  it('writes switch/menu parameters before knobs so sync does not reset a knob', async () => {
    const entry = Object.entries(EFFECT_PARAMS).find(([, defs]) =>
      defs.some((p) => p.type === 'switch') && defs.some((p) => p.type === 'knob')
      && defs.find((p) => p.type === 'knob')!.idx < defs.find((p) => p.type === 'switch')!.idx,
    );
    expect(entry).toBeDefined();
    const preset = createDefaultPreset();
    const effect = preset.effects[0];
    effect.effectId = Number(entry![0]);
    const defs = entry![1];
    const switchIdx = defs.find((p) => p.type === 'switch')!.idx;
    const knobIdx = defs.find((p) => p.type === 'knob')!.idx;
    effect.params[switchIdx] = 1;
    effect.params[knobIdx] = 42;
    const messages: Uint8Array[] = [];
    await writePresetLive(preset, 37, (message) => messages.push(message), async () => {});

    const find = (frame: Uint8Array) => messages.findIndex((message) =>
      message.length === frame.length && message.every((byte, index) => byte === frame[index]));
    const switchWrite = find(SysExCodec.buildParamChange(0, switchIdx, effect.effectId, 1));
    const knobWrite = find(SysExCodec.buildParamChange(0, knobIdx, effect.effectId, 42));
    expect(switchWrite).toBeGreaterThan(0);
    expect(knobWrite).toBeGreaterThan(switchWrite);
  });

  it('does not send unverified EXP frames during slot import', async () => {
    const preset = createDefaultPreset();
    preset.expAssignments = defaultExpAssignments();
    const messages: Uint8Array[] = [];
    await writePresetLive(preset, 239, (message) => messages.push(message), async () => {});
    expect(messages.some((message) => message[9] === 0x14 && message[30] === 0x0E)).toBe(false);
    expect(messages.some((message) =>
      message.length === 62 && message[9] === 0x18
      && SysExCodec.nibbleDecode(message.slice(13, -1))[8] === 0x0C)).toBe(false);
  });
});
