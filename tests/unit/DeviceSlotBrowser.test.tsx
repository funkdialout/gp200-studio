import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeviceSlotBrowser } from '@/components/DeviceSlotBrowser';

describe('DeviceSlotBrowser style filter', () => {
  it('shows only presets in the chosen style before loading one', () => {
    const names = new Array<string | null>(256).fill(null);
    const styles = new Array<number | null>(256).fill(null);
    names[0] = 'Heavy Lead'; styles[0] = 1;
    names[1] = 'Blue Room'; styles[1] = 8;
    const onConfirm = vi.fn();
    render(
      <DeviceSlotBrowser
        mode="pull"
        presetNames={names}
        presetStyles={styles}
        namesLoadProgress={256}
        currentSlot={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter patches by style' }), {
      target: { value: '8' },
    });
    expect(screen.getByText('Blue Room')).toBeTruthy();
    expect(screen.queryByText('Heavy Lead')).toBeNull();
    fireEvent.doubleClick(screen.getByText('Blue Room'));
    expect(onConfirm).toHaveBeenCalledWith(1);
  });
});
