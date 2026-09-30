import { useCallback, useEffect, useRef } from 'react';

export type EffectSender = (blockIndex: number, effectId: number) => void;

/** Minimum gap between two effect-change frames for the same block. */
export const EFFECT_SEND_GAP_MS = 150;

interface Coalesced {
  /** queue an effect change; the newest id per block wins */
  send: EffectSender;
  /** send a block's queued change now (call before a param edit on that block) */
  flush: (blockIndex: number) => void;
}

/**
 * Throttle effect-model changes per block: the first change goes out at once,
 * then at most one more per EFFECT_SEND_GAP_MS, always carrying the newest id.
 *
 * Clicking the pedal's ‹ › arrows (or holding Enter on one) can step through a
 * dozen models a second. Each step is a model load on the pedal, and the
 * in-between models are ones the player already skipped, so only the latest
 * needs to land. A single picker choice is still sent immediately.
 *
 * Local preset state is not delayed; only the wire is.
 */
export function useCoalescedEffectSend(sender: EffectSender): Coalesced {
  const pending = useRef(new Map<number, number>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const senderRef = useRef(sender);
  useEffect(() => {
    senderRef.current = sender;
  });

  const open = useCallback((blockIndex: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(blockIndex);
      const effectId = pending.current.get(blockIndex);
      if (effectId === undefined) return;
      pending.current.delete(blockIndex);
      senderRef.current(blockIndex, effectId);
      // keep the gap after a trailing send too
      open(blockIndex);
    }, EFFECT_SEND_GAP_MS);
    timers.current.set(blockIndex, timer);
  }, []);

  const send = useCallback<EffectSender>(
    (blockIndex, effectId) => {
      if (timers.current.has(blockIndex)) {
        pending.current.set(blockIndex, effectId);
        return;
      }
      senderRef.current(blockIndex, effectId);
      open(blockIndex);
    },
    [open],
  );

  const flush = useCallback((blockIndex: number) => {
    const effectId = pending.current.get(blockIndex);
    if (effectId === undefined) return;
    pending.current.delete(blockIndex);
    senderRef.current(blockIndex, effectId);
  }, []);

  useEffect(() => {
    const timerMap = timers.current;
    const pendingMap = pending.current;
    return () => {
      // an unmount mid-burst is still a change the user made
      for (const timer of timerMap.values()) clearTimeout(timer);
      timerMap.clear();
      for (const [blockIndex, effectId] of pendingMap) senderRef.current(blockIndex, effectId);
      pendingMap.clear();
    };
  }, []);

  return { send, flush };
}
