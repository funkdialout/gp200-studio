import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { EFFECT_SEND_GAP_MS, useCoalescedEffectSend } from '@/hooks/useCoalescedEffectSend';

describe('useCoalescedEffectSend', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a lone change immediately', () => {
    const sender = vi.fn();
    const { result } = renderHook(() => useCoalescedEffectSend(sender));
    result.current.send(2, 111);
    expect(sender).toHaveBeenCalledExactlyOnceWith(2, 111);
  });

  it('collapses a burst to the first and the newest', () => {
    const sender = vi.fn();
    const { result } = renderHook(() => useCoalescedEffectSend(sender));
    result.current.send(2, 1);
    result.current.send(2, 2);
    result.current.send(2, 3);
    result.current.send(2, 4);
    expect(sender).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(EFFECT_SEND_GAP_MS);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender).toHaveBeenLastCalledWith(2, 4);
    vi.advanceTimersByTime(EFFECT_SEND_GAP_MS * 3);
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('throttles each block independently', () => {
    const sender = vi.fn();
    const { result } = renderHook(() => useCoalescedEffectSend(sender));
    result.current.send(2, 1);
    result.current.send(5, 9);
    expect(sender.mock.calls).toEqual([[2, 1], [5, 9]]);
  });

  it('flush sends a queued change now, once', () => {
    const sender = vi.fn();
    const { result } = renderHook(() => useCoalescedEffectSend(sender));
    result.current.send(2, 1);
    result.current.send(2, 2);
    result.current.flush(2);
    expect(sender).toHaveBeenLastCalledWith(2, 2);
    vi.advanceTimersByTime(EFFECT_SEND_GAP_MS * 2);
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('sends a pending change on unmount', () => {
    const sender = vi.fn();
    const { result, unmount } = renderHook(() => useCoalescedEffectSend(sender));
    result.current.send(2, 1);
    result.current.send(2, 2);
    unmount();
    expect(sender).toHaveBeenLastCalledWith(2, 2);
  });
});
