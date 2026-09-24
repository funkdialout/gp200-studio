import { EFFECT_MAP } from './effectNames';
import { userIrSlotIndex } from './userIr';

/** -1 = previous effect, 1 = next effect. */
export type CycleDirection = -1 | 1;

/**
 * Effect ids the pedal's ‹ › arrows step through for one block, in device
 * order (ascending effect id, the order the GP-200's own knob scrolls in; for
 * the cab block that puts the 20 User IR slots after the built-in cabs).
 *
 * Empty User IR slots are skipped once the device has reported its IR names.
 * Before that (offline, or names still loading) every slot stays reachable,
 * because an unknown name is not proof of an empty slot. The current effect is
 * always kept so stepping away from an empty IR slot has a starting point.
 */
export function cycleCandidates(
  module: string,
  currentEffectId: number,
  userIrNames: readonly string[],
): number[] {
  const namesKnown = userIrNames.length > 0;
  const ids: number[] = [];
  for (const [key, info] of Object.entries(EFFECT_MAP)) {
    if (info.module !== module) continue;
    const effectId = Number(key);
    const irSlot = userIrSlotIndex(effectId);
    const emptyIr = namesKnown && irSlot !== null && !(userIrNames[irSlot]?.trim());
    if (emptyIr && effectId !== currentEffectId) continue;
    ids.push(effectId);
  }
  return ids.sort((a, b) => a - b);
}

/**
 * The effect one step from `currentEffectId`, wrapping at both ends. An id the
 * list doesn't contain (unmapped/zeroed slot) steps to the first or last entry.
 * Returns null when there is nothing else to switch to.
 */
export function stepEffect(
  module: string,
  currentEffectId: number,
  direction: CycleDirection,
  userIrNames: readonly string[],
): number | null {
  const ids = cycleCandidates(module, currentEffectId, userIrNames);
  if (ids.length === 0) return null;
  const at = ids.indexOf(currentEffectId);
  const next =
    at === -1
      ? ids[direction === 1 ? 0 : ids.length - 1]
      : ids[(at + direction + ids.length) % ids.length];
  return next === currentEffectId ? null : next;
}
