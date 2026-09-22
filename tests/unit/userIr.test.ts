import { describe, expect, it } from 'vitest';
import {
  USER_IR_QUERY_PAGES,
  USER_IR_SLOT_COUNT,
  userIrSlotIndex,
} from '@/core/userIr';

describe('User IR slots', () => {
  it('enumerates exactly the device\'s 20 slots', () => {
    const queryCount = USER_IR_QUERY_PAGES.reduce(
      (total, page) => total + page.blockCount,
      0,
    );
    expect(USER_IR_SLOT_COUNT).toBe(20);
    expect(queryCount).toBe(USER_IR_SLOT_COUNT);
    expect(USER_IR_QUERY_PAGES).toEqual([
      { page: 0, blockCount: 16 },
      { page: 1, blockCount: 4 },
    ]);
  });

  it('decodes only valid CAB User-IR effect ids', () => {
    expect(userIrSlotIndex(0x0A100000)).toBe(0);
    expect(userIrSlotIndex(0x0A100013)).toBe(19);
    expect(userIrSlotIndex(0x0A100014)).toBeNull();
    expect(userIrSlotIndex(0x0A000013)).toBeNull();
    expect(userIrSlotIndex(0x07100000)).toBeNull();
  });
});
