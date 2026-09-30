/** Physical User-IR capacity documented for the GP-200. */
export const USER_IR_SLOT_COUNT = 20;

/**
 * The editor reads the 20 names as two pages from section 0: 16 + 4.
 * Section 1 is a different ten-record table and must not be appended here.
 */
export const USER_IR_QUERY_PAGES = [
  { page: 0, blockCount: 16 },
  { page: 1, blockCount: 4 },
] as const;

/** Return the zero-based User-IR slot encoded by an effect id, if any. */
export function userIrSlotIndex(effectId: number): number | null {
  const moduleType = (effectId >>> 24) & 0xFF;
  const subcategory = (effectId >>> 16) & 0xFF;
  const slot = effectId & 0xFF;
  if (moduleType !== 0x0A || subcategory !== 0x10 || slot >= USER_IR_SLOT_COUNT) {
    return null;
  }
  return slot;
}

/**
 * The name of the IR loaded in a User-IR slot, or null when the effect is not a
 * User-IR slot or the device has not reported a name for it (offline, still
 * loading, or an empty slot).
 */
export function loadedUserIrName(effectId: number, userIrNames: readonly string[]): string | null {
  const slot = userIrSlotIndex(effectId);
  if (slot === null) return null;
  return userIrNames[slot]?.trim() || null;
}

/** Caption for a User-IR slot, e.g. "User IR 03". */
export function userIrSlotLabel(effectId: number): string | null {
  const slot = userIrSlotIndex(effectId);
  return slot === null ? null : `User IR ${String(slot + 1).padStart(2, '0')}`;
}
