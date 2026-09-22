import type { GP200Preset } from './types';
import { getEffectParams } from './effectParams';

/** Compare the fields the slot's live-write sequence can actually persist.
 * The GP-200 can round floating-point parameters, so compare them within a
 * small relative tolerance rather than demanding byte-identical readback. */
export function presetWriteMismatch(expected: GP200Preset, actual: GP200Preset): string | null {
  if (actual.patchName !== expected.patchName) {
    return `name is “${actual.patchName}” instead of “${expected.patchName}”`;
  }
  if (actual.patchStyle !== expected.patchStyle) return 'style differs';
  if (actual.patchVolume !== expected.patchVolume) return 'patch volume differs';
  if (actual.patchPan !== expected.patchPan) return 'patch pan differs';
  if (actual.patchTempo !== expected.patchTempo) return 'patch tempo differs';
  if (actual.effects.length !== expected.effects.length) return 'effect block count differs';
  if (actual.effects.some((effect, index) => effect.slotIndex !== expected.effects[index].slotIndex)) {
    return 'effect order differs';
  }
  if (actual.fxLoopSend !== expected.fxLoopSend || actual.fxLoopReturn !== expected.fxLoopReturn) {
    return 'FX-loop routing differs';
  }

  const actualByBlock = new Map(actual.effects.map((effect) => [effect.slotIndex, effect]));
  for (const wanted of expected.effects) {
    const got = actualByBlock.get(wanted.slotIndex);
    if (!got) return `effect block ${wanted.slotIndex} is missing`;
    if (got.effectId !== wanted.effectId) return `effect block ${wanted.slotIndex} uses a different model`;
    if (got.enabled !== wanted.enabled) return `effect block ${wanted.slotIndex} has a different on/off state`;
    // Unused float slots are neither sent by the live writer nor guaranteed to
    // survive an algorithm switch; verify only the model's real controls.
    const definitions = getEffectParams(wanted.effectId);
    const indices = definitions.length ? [...new Set(definitions.map((p) => p.idx))] : wanted.params.map((_, p) => p);
    for (const p of indices) {
      const tolerance = Math.max(0.005, Math.abs(wanted.params[p]) * 0.002);
      if (!Number.isFinite(got.params[p]) || Math.abs(got.params[p] - wanted.params[p]) > tolerance) {
        return `effect block ${wanted.slotIndex} parameter ${p + 1} differs`;
      }
    }
  }

  if (expected.ctrlAssignments?.length) {
    const gotMasks = new Map(actual.ctrlAssignments?.map((a) => [a.ctrlIndex, a.blockMask]));
    for (const assignment of expected.ctrlAssignments) {
      if (gotMasks.get(assignment.ctrlIndex) !== assignment.blockMask) {
        return `footswitch ${assignment.ctrlIndex + 1} assignment differs`;
      }
    }
  }
  return null;
}

/** EXP targets are presently read-only in bulk slot writes. Keep this separate
 * from the hard write check so a playable, verified patch can still open while
 * the app prominently reports retained controller settings. */
export function expressionAssignmentMismatch(expected: GP200Preset, actual: GP200Preset): string | null {
  if (!expected.expAssignments?.length) return null;
  const gotAssignments = new Map(actual.expAssignments?.map((a) => [`${a.page}:${a.item}`, a]));
  for (const assignment of expected.expAssignments) {
    const got = gotAssignments.get(`${assignment.page}:${assignment.item}`);
    if (!got || got.blockIndex !== assignment.blockIndex || got.paramIndex !== assignment.paramIndex) {
      const wanted = assignment.blockIndex === null
        ? 'unassigned' : `block ${assignment.blockIndex}, parameter ${assignment.paramIndex}`;
      const received = !got ? 'missing' : got.blockIndex === null
        ? 'unassigned' : `block ${got.blockIndex}, parameter ${got.paramIndex}`;
      return `expression assignment ${assignment.page + 1}/${assignment.item + 1} differs (wanted ${wanted}; read ${received})`;
    }
    if (Math.abs(got.min - assignment.min) > 0.005 || Math.abs(got.max - assignment.max) > 0.005) {
      return `expression assignment ${assignment.page + 1}/${assignment.item + 1} range differs`;
    }
  }
  return null;
}
