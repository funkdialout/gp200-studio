import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pedal } from '@/components/board/Pedal';
import type { EffectSlot } from '@/core/types';

const cabSlot = (effectId: number): EffectSlot => ({
  slotIndex: 5,
  effectId,
  enabled: true,
  params: Array(15).fill(0),
});

const noop = vi.fn();
const handlers = {
  onToggle: noop,
  onOpenPicker: noop,
  onCycle: noop,
  onParamChange: noop,
  onDragStart: noop,
  onMove: noop,
  onInspect: noop,
  onPin: noop,
  isPinned: false,
  chainLength: 11,
  index: 5,
};

describe('Pedal on a User-IR slot', () => {
  it('shows the loaded IR name and slot number instead of "User IR"', () => {
    render(<Pedal slot={cabSlot(0x0A100002)} userIrNames={['A', 'B', '03-412-MRSHLL77']} {...handlers} />);
    expect(screen.getByRole('button', { name: /Change CAB effect: 03-412-MRSHLL77/ })).toBeTruthy();
    expect(screen.getByText('User IR 03')).toBeTruthy();
  });

  it('falls back to the effect name when the device has not reported names', () => {
    render(<Pedal slot={cabSlot(0x0A100002)} {...handlers} />);
    expect(screen.getByRole('button', { name: /Change CAB effect: User IR/i })).toBeTruthy();
  });
});
