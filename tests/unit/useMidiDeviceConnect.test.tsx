import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SysExCodec } from '@/core/SysExCodec';
import { createDefaultPreset } from '@/core/defaultPreset';
import { useMidiDevice } from '@/hooks/useMidiDevice';

const HEADER = [0xF0, 0x21, 0x25, 0x7E, 0x47, 0x50, 0x2D, 0x32];

function response(sub: number, offset = 0, slot = 0): Uint8Array {
  return new Uint8Array([...HEADER, 0x12, sub, slot, offset, 0, 0, 0xF7]);
}

function mockDevice() {
  const input = { name: 'GP-200 MIDI IN', onmidimessage: null as null | ((event: { data: Uint8Array }) => void) };
  const requests: string[] = [];
  const output = {
    name: 'GP-200 MIDI OUT',
    send(message: Uint8Array) {
      const sub = message[9];
      if (sub === 0x04 && message[14] === 0x01) input.onmidimessage?.({ data: response(0x08) });
      if (sub === 0x04 && message[14] === 0x06) {
        for (let i = 0; i < 5; i++) input.onmidimessage?.({ data: response(0x4E, i) });
      }
      if (sub === 0x0A) input.onmidimessage?.({ data: response(0x0A) });
      if (sub === 0x1C) input.onmidimessage?.({ data: response(0x1C) });
      if (sub === 0x10) {
        const slot = (message[25] << 4) | message[26];
        requests.push(SysExCodec.slotToLabel(slot));
        for (let i = 0; i < 7; i++) input.onmidimessage?.({ data: response(0x18, i, slot) });
      }
    },
  };
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: vi.fn(async () => ({
      sysexEnabled: true,
      inputs: new Map([['in', input]]),
      outputs: new Map([['out', output]]),
    })),
  });
  vi.spyOn(SysExCodec, 'parseStateDump').mockReturnValue({ slot: 95 });
  return requests;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess;
});

describe('useMidiDevice connection', () => {
  it('catches synchronous responses and loads the active preset first', async () => {
    const requests = mockDevice();
    vi.spyOn(SysExCodec, 'parseReadChunks').mockReturnValue(createDefaultPreset());
    const { result, unmount } = renderHook(() => useMidiDevice());

    await act(async () => { await result.current.connect(); });

    expect(requests[0]).toBe('24D');
    expect(result.current.status).toBe('connected');
    expect(result.current.currentPreset).not.toBeNull();
    unmount();
  });

  it('does not claim a connection when the active preset cannot be parsed', async () => {
    mockDevice();
    vi.spyOn(SysExCodec, 'parseReadChunks').mockImplementation((chunks) => {
      if (chunks[0][10] === 95) throw new Error('Invalid preset data');
      return createDefaultPreset();
    });
    const { result, unmount } = renderHook(() => useMidiDevice());

    await act(async () => { await result.current.connect(); });

    expect(result.current.status).toBe('error');
    expect(result.current.currentPreset).toBeNull();
    expect(result.current.errorMessage).toContain('Could not read current preset 24D (Invalid preset data)');
    unmount();
  });
});
