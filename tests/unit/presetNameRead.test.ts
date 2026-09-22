import { describe, expect, it, vi } from 'vitest';
import {
  isPresetNameResponseComplete,
  readPresetNameReliably,
} from '@/core/presetNameRead';

describe('readPresetNameReliably', () => {
  it('uses a successful fast name read without requesting the full preset', async () => {
    const readFast = vi.fn().mockResolvedValue('Classic JC');
    const readFull = vi.fn().mockResolvedValue('should not be read');

    await expect(readPresetNameReliably(null, readFast, readFull)).resolves.toEqual({
      name: 'Classic JC',
      fastSupported: true,
    });
    expect(readFull).not.toHaveBeenCalled();
  });

  it('falls back to a full read after a transient fast timeout', async () => {
    const readFast = vi.fn().mockResolvedValue(null);
    const readFull = vi.fn().mockResolvedValue('Real Jazz');

    await expect(readPresetNameReliably(true, readFast, readFull)).resolves.toEqual({
      name: 'Real Jazz',
      fastSupported: true,
    });
    expect(readFull).toHaveBeenCalledOnce();
  });

  it('disables the fast path when its initial probe fails but a full read works', async () => {
    await expect(readPresetNameReliably(
      null,
      vi.fn().mockResolvedValue(null),
      vi.fn().mockResolvedValue('Warm OD'),
    )).resolves.toEqual({ name: 'Warm OD', fastSupported: false });
  });

  it('does not start a full read when the surrounding scan was aborted', async () => {
    const readFull = vi.fn().mockResolvedValue('too late');
    await expect(readPresetNameReliably(
      true,
      vi.fn().mockResolvedValue(null),
      readFull,
      () => true,
    )).resolves.toEqual({ name: null, fastSupported: true });
    expect(readFull).not.toHaveBeenCalled();
  });

  it('does not complete a full fallback read when only its name chunk arrived', () => {
    expect(isPresetNameResponseComplete(false, new Set([0]))).toBe(false);
    expect(isPresetNameResponseComplete(false, new Set([0, 183, 366, 549, 732, 915]))).toBe(false);
  });

  it('waits for seven unique full-read chunks but completes a fast read at offset zero', () => {
    const fullOffsets = new Set([0, 183, 366, 549, 732, 915, 1098]);
    expect(isPresetNameResponseComplete(false, fullOffsets)).toBe(true);
    expect(isPresetNameResponseComplete(true, new Set([0]))).toBe(true);
    expect(isPresetNameResponseComplete(true, new Set([183]))).toBe(false);
  });
});
