import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EffectPicker } from '@/components/board/EffectPicker';

describe('EffectPicker User IRs', () => {
  it('shows the loaded slot name and selects that exact User-IR id', () => {
    const userIrNames = Array.from({ length: 20 }, (_, slot) => `IR slot ${slot + 1}`);
    userIrNames[7] = 'My Mesa 4x12';
    const onSelect = vi.fn();

    render(
      <EffectPicker
        open
        module="CAB"
        currentEffectId={-1}
        userIrNames={userIrNames}
        artIndex={null}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    const row = screen.getByRole('button', { name: /My Mesa 4x12/i });
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(0x0A100007);
  });

  it('falls back to the catalog label when a slot name is blank', () => {
    render(
      <EffectPicker
        open
        module="CAB"
        currentEffectId={-1}
        userIrNames={['']}
        artIndex={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByText('User IR')).toHaveLength(20);
  });
});
