import { getEffectParams } from './effectParams';
import { patchStyleName } from './patchStyles';
import { SysExCodec } from './SysExCodec';
import type { GP200Preset } from './types';

type Send = (message: Uint8Array) => void;
type Sleep = (milliseconds: number) => Promise<void>;
const defaultSleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** The order and pacing follow the hardware-verified gp200_write.py sequence.
 * A save-commit persists the current edit buffer; chunk upload is not used. */
export async function writePresetLive(
  preset: GP200Preset,
  slot: number,
  send: Send,
  sleep: Sleep = defaultSleep,
): Promise<void> {
  const sendAndWait = async (message: Uint8Array, milliseconds: number) => {
    send(message);
    await sleep(milliseconds);
  };

  await sendAndWait(SysExCodec.buildPresetChange(slot), 300);
  for (const effect of preset.effects) {
    const block = effect.slotIndex;
    await sendAndWait(SysExCodec.buildEffectChange(block, effect.effectId), 40);
    // The pedal ignores parameter writes while a block is bypassed.
    await sendAndWait(SysExCodec.buildToggleEffect(block, true), 20);
    const definitions = getEffectParams(effect.effectId);
    const indices = definitions.length
      ? [...definitions.filter((p) => p.type !== 'knob'), ...definitions.filter((p) => p.type === 'knob')]
          .map((p) => p.idx)
      : effect.params.map((_, index) => index);
    for (const index of new Set(indices)) {
      const value = effect.params[index];
      await sendAndWait(
        SysExCodec.buildParamChange(block, index, effect.effectId, Number.isFinite(value) ? value : 0),
        12,
      );
    }
    await sendAndWait(SysExCodec.buildToggleEffect(block, effect.enabled), 20);
  }

  await sleep(50);
  await sendAndWait(SysExCodec.buildReorderEffects(
    preset.effects.map((effect) => effect.slotIndex), preset.fxLoopSend, preset.fxLoopReturn,
  ), 40);
  await sendAndWait(SysExCodec.buildPatchSetting(0x00, preset.patchVolume), 40);
  await sendAndWait(SysExCodec.buildPatchSetting(0x06, preset.patchPan & 0xFF), 40);
  await sendAndWait(SysExCodec.buildPatchSetting(0x01, preset.patchTempo), 40);
  await sendAndWait(SysExCodec.buildAuthorName(preset.author ?? ''), 40);
  await sendAndWait(SysExCodec.buildStyleName(
    preset.patchStyle === 0 ? '' : patchStyleName(preset.patchStyle),
  ), 40);
  await sendAndWait(SysExCodec.buildNote(preset.patchNote ?? ''), 40);

  if (preset.ctrlAssignments) {
    for (const assignment of preset.ctrlAssignments) {
      await sendAndWait(SysExCodec.buildCtrlAssignment(
        assignment.ctrlIndex, assignment.blockMask, assignment.state ?? 0,
      ), 40);
    }
  }
  // The captured EXP navigation/range frames do not persist assignments in
  // this slot-write flow on the user's pedal. Do not guess at a transfer here:
  // retain the target slot's EXP data and report the difference after readback.

  await sendAndWait(SysExCodec.buildSaveCommit(preset.patchName, slot), 500);
  await sendAndWait(SysExCodec.buildPresetChange(slot), 300);
}
