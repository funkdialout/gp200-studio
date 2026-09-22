import { useState, useRef, useCallback, useEffect } from 'react';
import { SysExCodec, type DeviceStateDump } from '@/core/SysExCodec';
import { decodeControlChange } from '@/core/midiControlMap';
import {
  isAssignmentDumpEnabled,
  isMidiMonitorEnabled,
  isNameWriteEnabled,
} from '@/core/debugFlags';
import { hexOfBytes } from '@/core/looperTriggers';
import type { GP200Preset } from '@/core/types';
import type { CCCommand } from '@/core/ccControl';
import { presetNameCacheKey, loadCachedNames, loadCachedStyles, saveCachedNames } from '@/core/presetNameCache';
import { isPresetNameResponseComplete, readPresetNameReliably } from '@/core/presetNameRead';
import type { BulkApplyOptions, BulkApplyProgress } from '@/core/bulkApply';
import { track } from '@/core/analytics';
import { presetWriteMismatch } from '@/core/presetWriteVerification';
import { writePresetLive } from '@/core/presetLiveWrite';
import { USER_IR_QUERY_PAGES } from '@/core/userIr';
import {
  describeHandshakeSilence,
  describeMidiAccessDenied,
  describeMissingDevice,
  describeSysexDenied,
} from '@/core/midiPortDiagnostics';
import { useMidiSend } from './useMidiSend';

const READ_TIMEOUT_MS = 3000;

function isSysEx(data: Uint8Array, cmd: number, sub: number): boolean {
  return (
    data.length > 10 &&
    data[0] === 0xF0 &&
    data[1] === 0x21 && data[2] === 0x25 && data[3] === 0x7E &&
    data[4] === 0x47 && data[5] === 0x50 && data[6] === 0x2D && data[7] === 0x32 &&
    data[8] === cmd && data[9] === sub
  );
}

/** Safely extract a Uint8Array from a MIDI message event's data field.
 *  The real MIDIMessageEvent.data is Uint8Array; our mock also passes a Uint8Array. */
function getBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof DataView) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data as ArrayBuffer);
}

/** A real MIDIPort types `name` as `string | null`; our mocks match it. */
function portName(port: unknown): string | null {
  return (port as { name: string | null }).name;
}

/** The GP-200 identifies itself by name on every platform we support. */
function isGP200Port(port: unknown): boolean {
  const name = portName(port);
  return typeof name === 'string' && name.includes('GP-200');
}

/** `navigator.userAgent`, or '' under the prerender's bare Node environment. */
function currentUserAgent(): string {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent;
}

/**
 * Whether this is Brave.
 *
 * Brave ships Chrome's user-agent string byte for byte, so the injected
 * `navigator.brave` object is the only tell, and it answers asynchronously.
 * Called on the failure paths only: a connect that works must not pay for a
 * question that only changes the wording of an error.
 */
async function detectBrave(): Promise<boolean> {
  const { brave } = navigator as { brave?: { isBrave?: () => Promise<boolean> } };
  if (!brave?.isBrave) return false;
  try {
    return await brave.isBrave();
  } catch {
    return false;
  }
}

/**
 * requestMIDIAccess, with the browser's two refusals turned into advice.
 *
 * Both are otherwise dead ends. A stored Block stops the browser prompting at
 * all, so the failure is instant, popup-less, and explained only by a
 * DOMException that does not say where the switch is; and an access granted
 * without SysEx looks like a total success right up until the handshake times
 * out twice for no visible reason. Checking sysexEnabled turns the second one
 * into a one-second failure with a fix in it.
 */
async function requestGP200Access(): Promise<GP200Access> {
  if (!('requestMIDIAccess' in navigator)) {
    throw new Error('Web MIDI API not supported in this browser');
  }
  const midiNavigator = navigator as unknown as {
    requestMIDIAccess: (opts: { sysex: boolean }) => Promise<GP200Access>;
  };
  let access: GP200Access;
  try {
    access = await midiNavigator.requestMIDIAccess({ sysex: true });
  } catch (err) {
    // Only the permission refusals get reworded; AbortError and friends mean
    // something else entirely and keep their own message.
    const { name } = err as { name?: string };
    if (name !== 'SecurityError' && name !== 'NotAllowedError') throw err;
    const message = describeMidiAccessDenied({ isBrave: await detectBrave() });
    throw new Error(message, { cause: err });
  }
  if (!access.sysexEnabled) {
    throw new Error(describeSysexDenied({ isBrave: await detectBrave() }));
  }
  return access;
}

/**
 * The message for a handshake that started and then failed.
 *
 * A timeout here is the costliest failure in the app: both ports opened, so
 * every "GP-200 not found" hint is wrong, and "Response timeout" alone names
 * none of the causes that actually explain it. Anything that is not a timeout
 * already carries its own message and keeps it.
 */
async function describeHandshakeFailure(err: unknown, sawAnyBytes: boolean): Promise<string> {
  if (!(err instanceof Error)) return 'Handshake failed';
  // A complete identity/state exchange followed by a failed preset read is
  // different from a silent handshake. Keep that specific diagnosis visible.
  if (err.message.startsWith('Could not read current preset')) return err.message;
  if (!/timeout/i.test(err.message)) return err.message;
  return describeHandshakeSilence({
    userAgent: currentUserAgent(),
    isBrave: await detectBrave(),
    sawAnyBytes,
  });
}

export interface UseMidiDeviceReturn {
  status: 'disconnected' | 'connecting' | 'handshaking' | 'connected' | 'error';
  handshakeStep: string | null;
  errorMessage: string | null;
  deviceName: string | null;
  currentSlot: number | null;
  presetNames: (string | null)[];
  /** Saved patch style per slot; null means metadata has not been read yet. */
  presetStyles: (number | null)[];
  namesLoadProgress: number;
  /** True while the background re-scan is verifying cache-seeded names against
   *  the device. Distinct from namesLoadProgress (which drives the first-load bar). */
  namesSyncing: boolean;
  deviceInfo: { deviceType: number; firmwareValues: number[]; versionAccepted: boolean } | null;
  currentPreset: GP200Preset | null;
  /** The 20 User-IR slot names enumerated during the handshake
   *  (0x11/0x1C query → 0x12/0x1C response). */
  userIrNames: string[];
  /** Typed view of the connect-time 0x4E state dump (tuner A4, global-EQ
   *  floats, drum style-group names, raw TLV records). Null until the
   *  handshake completes; see DeviceStateDump for per-field caveats. */
  deviceState: DeviceStateDump | null;

  connect: () => Promise<void>;
  disconnect: () => void;
  loadPresetNames: () => Promise<void>;
  /** Force re-read every slot and correct any that drifted from the cache-seeded
   *  values, persisting the result. Runs silently in the background after connect. */
  syncPresetNames: () => Promise<void>;
  /** Clear cached names (except the already-pulled current bank) and re-enumerate. */
  refreshNames: () => Promise<void>;
  pullPreset: (slot: number) => Promise<GP200Preset>;
  pushPreset: (preset: GP200Preset, slot: number) => Promise<GP200Preset>;
  writePresetToSlot: (preset: GP200Preset, slot: number) => Promise<void>;
  saveToSlot: (presetName: string, slot?: number, style?: number) => Promise<void>;
  /** Rename a slot without touching its effect data. Briefly switches the
   *  device to the target slot (required to load the editing buffer), then
   *  save-commits under the new name and restores the previous slot. */
  renameSlot: (slot: number, name: string) => Promise<void>;
  /** Write the same CTRL assignments and/or patch volume into every listed
   *  slot (preset-change → live writes → save-commit per slot). Progress in
   *  bulkApplyProgress; cancel with cancelBulkApply (finishes current slot). */
  bulkApply: (
    slots: number[],
    options: BulkApplyOptions,
  ) => Promise<{ done: number; cancelled: boolean }>;
  bulkApplyProgress: BulkApplyProgress | null;
  cancelBulkApply: () => void;
  sendToggle: (blockIndex: number, enabled: boolean) => void;
  sendParamChange: (blockIndex: number, paramIndex: number, effectId: number, value: number) => void;
  sendReorder: (order: number[], send: number, ret: number) => void;
  sendFxLoopMove: (order: number[], send: number, ret: number, which: 'send' | 'return') => void;
  sendSlotChange: (slot: number) => void;
  sendAuthor: (author: string) => void;
  sendStyleName: (styleName: string) => void;
  sendNote: (note: string) => void;
  sendEffectChange: (blockIndex: number, effectId: number) => void;
  sendPatchVolume: (value: number) => void;
  sendPatchPan: (deviceValue: number) => void;
  sendPatchTempo: (bpm: number) => void;
  sendRawChunks: (chunks: Uint8Array[], delayMs: number, onProgress?: (i: number, total: number) => void) => Promise<void>;
  sendExpParamSelect: (page: number, item: number, blockIndex: number, paramIdx: number) => void;
  sendExpMinMax: (page: number, item: number, min: number, max: number) => void;
  /** Per-patch CTRL footswitch → effect-block mask (whole mask, not per-bit). */
  sendCtrlAssignment: (ctrlIndex: number, blockMask: number, state?: number) => void;
  // Device-global settings (0x12/0x08 settings-write family, docs §0.2)
  sendFsMode: (mode: number) => void;
  sendFsTarget: (fs: number, kind: 'tap' | 'hold', actionId: number) => void;
  sendFsCombo: (comboIndex: number, actionId: number) => void;
  sendAutoCabMatch: (on: boolean) => void;
  // Plain MIDI CC (built-in looper / drums / tuner; src/core/ccControl.ts)
  sendCC: (command: CCCommand | CCCommand[]) => void;
  ccChannel: number;
  setCcChannel: (channel: number) => void;
  setOnDeviceChange: (cb: ((slot: number | null) => void) | null) => void;
  setOnDeviceToggle: (cb: ((blockIndex: number, enabled: boolean) => void) | null) => void;
  // Callback returns whether the change was applied (drives FX-state suppression)
  setOnDeviceEffectChange: (cb: ((blockIndex: number, effectId: number) => boolean) | null) => void;
  setOnDeviceParamChange: (cb: ((blockIndex: number, paramIndex: number, value: number) => void) | null) => void;
  // Real-time hardware controls for the loop station (wire format pending capture)
  setOnFootswitch: (cb: ((fsNumber: number, state: boolean) => void) | null) => void;
  setOnExpPosition: (cb: ((value: number) => void) | null) => void;
  // Raw-frame tap: the looper's MIDI-learn/hijack path. Runs before every
  // dispatcher branch; a true return consumes the frame.
  setOnLooperFrameTap: (
    cb:
      | ((data: Uint8Array, ctx: { suppressed: boolean; currentSlot: number | null }) => boolean)
      | null,
  ) => void;
}

// Minimal shape we actually use; avoids conflicts with DOM's MIDIInput / MIDIOutput
interface GP200Input {
  name: string | null;
  onmidimessage: ((event: { data: unknown }) => void) | null;
}
interface GP200Output {
  send: (data: Uint8Array | number[]) => void;
}
interface GP200Access {
  inputs: { values: () => Iterable<GP200Input> };
  outputs: { values: () => Iterable<GP200Output> };
  /** A browser can grant plain MIDI and withhold System Exclusive. Every frame
   *  this app sends or expects is SysEx, so a false here is fatal, silently. */
  sysexEnabled: boolean;
}

function waitForResponse(
  input: GP200Input,
  request: () => void,
  match: (data: Uint8Array) => boolean,
  timeoutMs: number,
  baseHandler: (event: { data: unknown }) => void,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, data?: Uint8Array) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.onmidimessage = baseHandler;
      if (error) reject(error);
      else resolve(data!);
    };
    const timer = setTimeout(() => {
      finish(new Error('Response timeout'));
    }, timeoutMs);
    input.onmidimessage = (event: { data: unknown }) => {
      const data = getBytes(event.data);
      baseHandler(event);
      if (match(data)) {
        finish(null, data);
      }
    };
    try { request(); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

function collectChunks(
  input: GP200Input,
  request: () => void,
  cmd: number,
  sub: number,
  expectedCount: number,
  timeoutMs: number,
  baseHandler: (event: { data: unknown }) => void,
): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const offsets = new Set<number>();
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.onmidimessage = baseHandler;
      if (error) reject(error);
      else resolve(chunks);
    };
    const timer = setTimeout(() => {
      finish(new Error(`Chunk collection timeout (${chunks.length}/${expectedCount} chunks)`));
    }, timeoutMs);
    input.onmidimessage = (event: { data: unknown }) => {
      const data = getBytes(event.data);
      baseHandler(event);
      if (isSysEx(data, cmd, sub)) {
        const offset = data[11] | (data[12] << 8);
        if (offsets.has(offset)) return;
        offsets.add(offset);
        chunks.push(new Uint8Array(data));
        if (chunks.length === expectedCount) {
          finish(null);
        }
      }
    };
    try { request(); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

export function useMidiDevice(): UseMidiDeviceReturn {
  const [status, setStatus] = useState<UseMidiDeviceReturn['status']>('disconnected');
  // Synchronous mirror of `status` for callbacks that must not re-create when it
  // changes (connect is memoised on [] and would otherwise read a stale value).
  const statusRef = useRef(status);
  statusRef.current = status;
  const [handshakeStep, setHandshakeStep] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [currentSlot, setCurrentSlot] = useState<number | null>(null);
  const [presetNames, setPresetNames] = useState<(string | null)[]>(new Array(256).fill(null));
  const [presetStyles, setPresetStyles] = useState<(number | null)[]>(new Array(256).fill(null));
  const [namesLoadProgress, setNamesLoadProgress] = useState(0);
  const [namesSyncing, setNamesSyncing] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<UseMidiDeviceReturn['deviceInfo']>(null);
  const [currentPreset, setCurrentPreset] = useState<GP200Preset | null>(null);
  const wasConnectedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const [userIrNames, setUserIrNames] = useState<string[]>([]);
  const [deviceState, setDeviceState] = useState<DeviceStateDump | null>(null);

  const outputRef          = useRef<GP200Output | null>(null);
  const inputRef           = useRef<GP200Input | null>(null);
  const presetNamesRef     = useRef<(string | null)[]>(new Array(256).fill(null));
  const presetStylesRef    = useRef<(number | null)[]>(new Array(256).fill(null));
  const currentSlotRef     = useRef<number | null>(null);
  const namesLoadAbortRef  = useRef<boolean>(false);
  const namesLoadRunningRef = useRef<boolean>(false);
  // localStorage cache key for this device's slot names (deviceType + port name),
  // computed during the handshake. null until connected / storage unavailable.
  const cacheKeyRef        = useRef<string | null>(null);
  // Whether the fast name-only read (sub=0x20, documented for fw 1.8.0) works
  // on this device. null = untested; probed once per connection, then either
  // used for every slot or permanently bypassed in favor of full reads.
  const fastNameReadRef    = useRef<boolean | null>(null);
  // While a flash push bounces the device across slots (park → write →
  // return), the device echoes each hop as a preset-change frame. Acting on
  // those would pull the park slot into the editor mid-save; ignore echoes
  // until this timestamp.
  const suppressSlotEchoUntilRef = useRef(0);
  // Whether ANY byte has arrived from the device since CONNECT was pressed.
  // The only thing that separates "another program owns this port" from "the
  // pedal answered, just not with what we asked for" when a handshake step
  // times out; see describeHandshakeSilence in core/midiPortDiagnostics.ts.
  const sawDeviceBytesRef = useRef(false);

  // Delegate all send operations, device-initiated callback registration,
  // and FX-state echo suppression to useMidiSend. The parent hook keeps
  // connection state + preset ops; useMidiSend owns everything else we
  // send to or receive from the pedal.
  //
  // onSlotChange keeps the local currentSlot state in sync whenever the
  // user triggers a slot change via sendSlotChange; previously that was
  // done inline at the end of the send callback.
  const send = useMidiSend({
    outputRef,
    onSlotChange: (slot) => {
      setCurrentSlot(slot);
      currentSlotRef.current = slot;
    },
  });
  const {
    deviceCallbacks: {
      onDeviceChangeRef,
      onDeviceToggleRef,
      onDeviceEffectChangeRef,
      onDeviceParamChangeRef,
      onFootswitchRef,
      onExpPositionRef,
      onLooperFrameTapRef,
    },
    suppressFxCountRef,
    suppressFxFor,
  } = send;

  const onMidiMessage = useCallback((event: { data: unknown }) => {
    const data = getBytes(event.data);
    // Before the tap below, which consumes frames and returns: this records
    // that the device is reachable at all, and a consumed frame proves that
    // just as well as a handled one.
    sawDeviceBytesRef.current = true;
    // Looper MIDI-learn/hijack tap runs before EVERY branch below: a consumed
    // frame (learn capture, hijacked stomp, debounced sibling) must never
    // reach the normal handlers , that's what keeps a hijacked toggle from
    // being mirrored into preset state. The tap passes anything it doesn't
    // own, so real slot changes, knob turns, and effect swaps fall through
    // untouched. See src/hooks/useLooperTriggers.ts.
    const tapConsumed = onLooperFrameTapRef.current?.(data, {
      suppressed: suppressFxCountRef.current > 0,
      currentSlot: currentSlotRef.current,
    });
    if (tapConsumed) return;
    let handled = false;
    // Real-time hardware controls arrive (per current hypothesis) as standard
    // Control Change messages, NOT SysEx, so they must be routed BEFORE the
    // 0xF0 SysEx checks below, which every downstream branch requires. The exact
    // CC numbers are pending a USB capture; decodeControlChange centralizes them
    // (see src/core/midiControlMap.ts + docs/protocol-capture.md §4).
    const control = decodeControlChange(data);
    if (control) {
      if (control.kind === 'exp') onExpPositionRef.current?.(control.value);
      else onFootswitchRef.current?.(control.fsNumber, control.state);
      return;
    }
    // sub=0x08 D→H: multipurpose, preset change echo vs FX state response
    // Distinguish by data[14]: 0x08 = preset change echo, other = FX state response.
    // CAUTION: hardware footswitch presses ALSO emit data[14]=0x08 frames whose
    // slot nibbles decode to the CURRENT slot, so data[14] alone is not a
    // sufficient discriminator (no capture of the full frame yet; see
    // docs/protocol-capture.md).
    if (isSysEx(data, 0x12, 0x08) && data.length >= 28) {
      handled = true;
      if (data[14] === 0x08 && (data[21] !== 0 || data[22] !== 0)) {
        // Global-settings write echo (FS Mode [21]=01/[22]=08, Auto Cab Match
        // [21]=02/[22]=04, ...): shares data[14]=0x08 with preset changes but
        // carries a nonzero setting address at [21],[22] where preset-change
        // frames have zeros (docs/protocol-capture.md §0.2). Without this
        // guard the value byte at [26] would decode as a bogus slot change.
        console.log(
          `[GP-200] settings echo ignored (addr=${data[21]}/${data[22]} value=${data[26]})`,
        );
      } else if (data[14] === 0x08) {
        // Preset change echo: slot nibble-encoded at data[25:26]
        const slot = ((data[25] & 0x0F) << 4) | (data[26] & 0x0F);
        if (Date.now() < suppressSlotEchoUntilRef.current) {
          console.log(`[GP-200] slot-change echo suppressed during push (slot=${slot})`);
        } else if (slot >= 0 && slot < 256 && slot !== currentSlotRef.current) {
          console.log(`[GP-200] device slot change: ${slot} (${SysExCodec.slotToLabel(slot)})`);
          setCurrentSlot(slot); currentSlotRef.current = slot;
          onDeviceChangeRef.current?.(slot);
        } else if (slot === currentSlotRef.current) {
          // Same-slot "change" frame: emitted on hardware footswitch presses.
          // Acting on it would re-pull the slot's FLASH copy and clobber
          // unsaved live edits (the device's edit buffer keeps them). Ignore.
          // Cost: re-selecting the same patch on the device won't force a
          // re-pull; it re-syncs on the next real slot change or manual LOAD.
          const hex = Array.from(data.subarray(10, 28), (b) => b.toString(16).padStart(2, '0')).join(' ');
          console.log(`[GP-200] same-slot change frame ignored (slot=${slot}, data[10..27]=${hex})`);
        }
      } else if (suppressFxCountRef.current === 0) {
        // FX state response: device reports effect toggle from hardware
        // data[22]=block_id (0=PRE..10=VOL), data[24]=state (0=OFF, non-zero=ON)
        // Suppressed during our own sends (responses are echoes, not hardware changes)
        const blockId = data[22];
        const state = data[24];
        if (blockId >= 0 && blockId <= 10) {
          console.log(`[GP-200] device FX toggle: block=${blockId} state=${state}`);
          onDeviceToggleRef.current?.(blockId, state !== 0);
        }
      }
    }
    // sub=0x0C D→H: effect change response (user changed effect type on hardware)
    // Format (38B raw): block@22, variant nibbles@29:31,
    // subcategory nibbles@33:35, module@36.  The subcategory is 0x10 for
    // User IRs and must survive the echo or 0x0A10xxxx becomes a built-in
    // 0x0A00xxxx cab in local state.
    // CAUTION: those module/variant offsets belong to the longer swap frame; on
    // the 38-byte footswitch-ack variant (CTRL 4-8 report a stomp as 0x0C where
    // CTRL 1-3 use 0x08) they land in an all-zero tail, which is precisely the
    // effectId===0 case dropped below. That ack carries block@22 and state@24,
    // the same offsets the 0x08 FX-state frame uses , see isFootswitchAck0c in
    // src/core/looperTriggers.ts, which must stay in step with this check.
    if (isSysEx(data, 0x12, 0x0C) && data.length >= 38) {
      handled = true;
      const change = SysExCodec.parseEffectChangeNotification(data);
      if (!change) return;
      const { blockIndex, effectId } = change;
      console.log(`[GP-200] device effect change: block=${blockIndex} effectId=0x${effectId.toString(16).padStart(8,'0')}`);
      // Hardware footswitch toggles also emit sub=0x0C frames with the
      // module/variant fields zeroed; decoded blindly that's "effect changed
      // to 0x00000000" (COMP) and the pedal morphs. An all-zero id IS that
      // ack shape, so drop it here (cost: a hardware switch to COMP itself
      // isn't mirrored; it re-syncs on the next slot change or pull). The
      // applied-callback further validates (known id, same module, actually
      // different); suppress the follow-up FX-state messages ONLY after a
      // real swap, so hardware toggle messages still reach onDeviceToggle.
      // Host-originated effect changes are echoed through this same 0x0C
      // family.  sendEffectChange raises suppressFxCountRef before writing;
      // honour it here just as the 0x08/0x10 handlers do, otherwise our own
      // acknowledgement is mistaken for a second hardware edit.
      if (effectId !== 0 && suppressFxCountRef.current === 0) {
        const applied = onDeviceEffectChangeRef.current?.(blockIndex, effectId) ?? false;
        if (applied) suppressFxFor(500);
      } else if (effectId !== 0) {
        console.log('[GP-200] effect-change echo suppressed');
      }
    }
    // sub=0x10 D→H: toggle OR knob notification (46 bytes)
    // Discriminator: bytes[29:37] all zeros = knob notification, otherwise = toggle
    if (isSysEx(data, 0x12, 0x10) && data.length >= 45) {
      handled = true;
      const isKnob = data[29] === 0 && data[30] === 0 && data[31] === 0 && data[32] === 0 &&
                     data[33] === 0 && data[34] === 0 && data[35] === 0 && data[36] === 0;
      if (isKnob) {
        // Knob notification: block at [22], param at [24], nibble float32 at [37:45]
        const blockId = data[22];
        const paramIdx = data[24];
        const hi0 = data[37], lo0 = data[38], hi1 = data[39], lo1 = data[40];
        const hi2 = data[41], lo2 = data[42], hi3 = data[43], lo3 = data[44];
        const buf = new Uint8Array([(hi0 << 4) | lo0, (hi1 << 4) | lo1, (hi2 << 4) | lo2, (hi3 << 4) | lo3]);
        const value = new DataView(buf.buffer).getFloat32(0, true);
        if (blockId >= 0 && blockId <= 10) {
          onDeviceParamChangeRef.current?.(blockId, paramIdx, value);
        }
      } else {
        // Toggle notification: block at [38], state at [40]
        const blockId = data[38];
        const state = data[40];
        if (blockId >= 0 && blockId <= 10) {
          console.log(`[GP-200] device toggle: block=${blockId} state=${state}`);
          onDeviceToggleRef.current?.(blockId, state !== 0);
        }
      }
    }
    // Opt-in monitor (src/core/debugFlags.ts): hex-dump any frame no branch
    // above recognized , exactly what the pending USB-capture work needs.
    if (!handled && isMidiMonitorEnabled()) {
      console.debug(`[GP-200] rx unhandled: ${hexOfBytes(data)}`);
    }
  // suppressFxFor is intentionally omitted: it's a plain function (not
  // useCallback-memoised) that only closes over the stable suppressFxCountRef,
  // so its identity changing every render doesn't affect behavior, but
  // including it would make onMidiMessage (and everything that depends on
  // it, e.g. `connect` below) unstable every render.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    onDeviceChangeRef, onDeviceToggleRef, onDeviceEffectChangeRef, onDeviceParamChangeRef,
    onFootswitchRef, onExpPositionRef, onLooperFrameTapRef, suppressFxCountRef,
    sawDeviceBytesRef,
  ]);

  /** Persist the current name list to localStorage under this device's key. */
  const persistNames = useCallback(() => {
    if (cacheKeyRef.current) {
      saveCachedNames(cacheKeyRef.current, presetNamesRef.current, presetStylesRef.current);
    }
  }, []);

  const connect = useCallback(async () => {
    // Top of the connect funnel. Instrumented here rather than in the Landing
    // button because the board deck and the phone DEVICE tab call connect too,
    // and all three (plus every retry) need to land in the same denominator.
    track('connect_start', { retry: statusRef.current === 'error' });
    setStatus('connecting');
    setErrorMessage(null);
    setCurrentPreset(null);
    sawDeviceBytesRef.current = false;
    try {
      const access = await requestGP200Access();

      const outputs = Array.from(access.outputs.values());
      const inputs = Array.from(access.inputs.values());
      const output = outputs.find(isGP200Port) ?? null;
      const input = inputs.find(isGP200Port) ?? null;

      if (!output || !input) {
        // Both halves of the survey, so "sees the pedal's input but not its
        // output" reads as the half-open port it is rather than as absence.
        throw new Error(describeMissingDevice({
          portNames: [...inputs, ...outputs].map(portName),
          userAgent: currentUserAgent(),
        }));
      }

      outputRef.current = output;
      inputRef.current  = input;
      input.onmidimessage = onMidiMessage;
      setDeviceName(input.name);
      setStatus('handshaking');
      setHandshakeStep(null);

      // --- Handshake sequence ---
      try {
        // Step 1-2: Identity
        setHandshakeStep('Identity…');
        const identityMsg = await waitForResponse(
          input, () => output.send(SysExCodec.buildIdentityQuery()),
          (d) => isSysEx(d, 0x12, 0x08), READ_TIMEOUT_MS, onMidiMessage
        );
        const identity = SysExCodec.parseIdentityResponse(identityMsg);
        // The GP-200 has no unique serial over MIDI, so key the name cache on the
        // generic deviceType byte + MIDI port name (effectively one per machine).
        cacheKeyRef.current = presetNameCacheKey(identity.deviceType, input.name);

        // Step 3-4: Enter editor mode
        setHandshakeStep('Editor Mode…');
        output.send(SysExCodec.buildEnterEditorMode());
        await new Promise(r => setTimeout(r, 100));

        // Step 5-6: State dump (0x4E: current slot at decoded[8:10] LE16)
        setHandshakeStep('State Dump…');
        const dumpChunks = await collectChunks(
          input, () => output.send(SysExCodec.buildStateDumpRequest()),
          0x12, 0x4E, 5, READ_TIMEOUT_MS, onMidiMessage,
        );
        const stateDump = SysExCodec.parseStateDump(dumpChunks);
        const slot = stateDump.slot;
        setDeviceState(stateDump);
        setCurrentSlot(slot); currentSlotRef.current = slot;

        // Step 7-8: Version check
        setHandshakeStep('Firmware Check…');
        const versionMsg = await waitForResponse(
          input, () => output.send(SysExCodec.buildVersionCheck()),
          (d) => isSysEx(d, 0x12, 0x0A), READ_TIMEOUT_MS, onMidiMessage
        );
        const { accepted } = SysExCodec.parseVersionResponse(versionMsg);
        setDeviceInfo({ ...identity, versionAccepted: accepted });

        // Step 9: User-IR slot enumeration (non-critical, short timeout, bail
        // on first failure). Section 0/page 0 contains slots 1-16 and page 1
        // contains 17-20. Section 1 is a different ten-record table.
        setHandshakeStep('User IRs…');
        const ASSIGN_TIMEOUT = 300;
        const assignmentEntries: {
          section: number; page: number; block: number; name: string; rawData: Uint8Array;
        }[] = [];
        let assignFailed = false;
        for (const { page, blockCount } of USER_IR_QUERY_PAGES) {
          if (assignFailed) break;
          for (let block = 0; block < blockCount; block++) {
            try {
              const resp = await waitForResponse(
                input, () => output.send(SysExCodec.buildAssignmentQuery(0, page, block)),
                (d) => isSysEx(d, 0x12, 0x1C), ASSIGN_TIMEOUT, onMidiMessage
              );
              assignmentEntries.push(SysExCodec.parseAssignmentResponse(resp, 0, page));
            } catch {
              assignFailed = true; break; // bail on first failure: device unresponsive
            }
          }
        }
        setUserIrNames(assignmentEntries.map((entry) => entry.name));

        // Opt-in raw dump (src/core/debugFlags.ts): hex of each 0x12/0x1C
        // response, for eyeballing the record layout beyond the name field.
        if (isAssignmentDumpEnabled()) {
          console.log(`[GP-200] User-IR sweep: ${assignmentEntries.length} responses`);
          for (const entry of assignmentEntries) {
            const hex = [...entry.rawData]
              .map((byte) => byte.toString(16).padStart(2, '0'))
              .join(' ');
            console.log(
              `  s${entry.section} p${entry.page} b${entry.block} ` +
              `name="${entry.name}" raw=${hex}`,
            );
          }
        }

        // Step 10: Pull the active slot first. Other bank names are useful but
        // must not delay or prevent opening the preset the user is playing.
        const bankBase = Math.floor(slot / 4) * 4;
        const bankSlots = [slot, ...Array.from({ length: 4 }, (_, i) => bankBase + i).filter(s => s !== slot)];
        let currentPresetError: unknown = null;
        let currentPresetLoaded = false;
        for (const s of bankSlots) {
          const label = SysExCodec.slotToLabel(s);
          setHandshakeStep(`Slot ${label}…`);
          try {
            const chunks = await collectChunks(
              input, () => output.send(SysExCodec.buildReadRequest(s)),
              0x12, 0x18, 7, READ_TIMEOUT_MS, onMidiMessage,
            );
            const p = SysExCodec.parseReadChunks(chunks);
            setHandshakeStep(`Slot ${label} · ${p.patchName}`);
            if (s === slot) {
              setCurrentPreset(p);
              currentPresetLoaded = true;
            }
            presetNamesRef.current[s] = p.patchName;
            presetStylesRef.current[s] = p.patchStyle;
          } catch (error) {
            if (s === slot) currentPresetError = error;
            setHandshakeStep(`Slot ${label} · –`);
            if (s === slot) break;
          }
          await new Promise(r => setTimeout(r, 20));
        }

        // The slot number and patch name can come from the state dump and a
        // previous browser cache. Neither proves the current patch loaded.
        // Never advertise a usable connection with no editor preset.
        if (!currentPresetLoaded) {
          const label = SysExCodec.slotToLabel(slot);
          const detail = currentPresetError instanceof Error
            ? currentPresetError.message : String(currentPresetError);
          throw new Error(`Could not read current preset ${label} (${detail}). Reconnect the GP-200 and close other MIDI editors.`);
        }

        // Step 11: Seed remaining slots from the local cache so the Patch Manager
        // shows names instantly. The bank slots just pulled are device-truth and
        // are kept; only still-null slots are filled. A full cache lets us mark
        // loading complete (progress 256) so no "Loading names…" bar appears; the
        // background sync (syncPresetNames) then re-verifies every slot silently.
        const cached = cacheKeyRef.current ? loadCachedNames(cacheKeyRef.current) : null;
        const cachedStyles = cacheKeyRef.current ? loadCachedStyles(cacheKeyRef.current) : null;
        if (cached) {
          for (let s = 0; s < 256; s++) {
            if (presetNamesRef.current[s] === null) presetNamesRef.current[s] = cached[s];
          }
          const filledCount = presetNamesRef.current.filter((n) => n !== null).length;
          if (filledCount === 256) setNamesLoadProgress(256);
        }
        if (cachedStyles) {
          for (let s = 0; s < 256; s++) {
            if (presetStylesRef.current[s] === null) presetStylesRef.current[s] = cachedStyles[s];
          }
        }
        setPresetNames([...presetNamesRef.current]);
        setPresetStyles([...presetStylesRef.current]);
        // Persist the freshly-pulled bank names into the cache immediately.
        persistNames();

        // Step 12: Done
        setHandshakeStep(null);
        setStatus('connected');
      } catch (err) {
        setStatus('error');
        setErrorMessage(await describeHandshakeFailure(err, sawDeviceBytesRef.current));
      }
    } catch (err) {
      setStatus('error');
      if (err instanceof Error) setErrorMessage(err.message);
      else setErrorMessage('Connection failed');
    }
  }, [onMidiMessage, persistNames]);

  const disconnect = useCallback(() => {
    namesLoadAbortRef.current = true;
    namesLoadRunningRef.current = false;
    setNamesSyncing(false);
    if (inputRef.current) inputRef.current.onmidimessage = null;
    outputRef.current = null;
    inputRef.current  = null;
    setStatus('disconnected');
    setDeviceName(null);
    setCurrentSlot(null); currentSlotRef.current = null;
    setErrorMessage(null);
    setDeviceInfo(null);
    setCurrentPreset(null);
    setUserIrNames([]);
    setDeviceState(null);
    fastNameReadRef.current = null;
  }, []);

  /** Abort background name loading and wait for it to stop */
  const pauseNameLoading = useCallback(async () => {
    if (namesLoadRunningRef.current) {
      namesLoadAbortRef.current = true;
      // Wait past the longest 1.5s full-read timeout so the background handler
      // cannot restore itself over a foreground pull/save handler.
      for (let i = 0; i < 40 && namesLoadRunningRef.current; i++) {
        await new Promise(r => setTimeout(r, 50));
      }
    }
  }, []);

  const pullPreset = useCallback(async (slot: number): Promise<GP200Preset> => {
    await pauseNameLoading();
    return new Promise((resolve, reject) => {
      if (!outputRef.current || !inputRef.current) {
        reject(new Error('Not connected'));
        return;
      }
      const chunks: Uint8Array[] = [];
      let attempts = 0;
      let timer: ReturnType<typeof setTimeout>;

      function tryRequest() {
        chunks.length = 0;
        timer = setTimeout(() => {
          if (attempts < 1) {
            attempts++;
            tryRequest();
          } else {
            if (inputRef.current) inputRef.current.onmidimessage = onMidiMessage;
            setStatus('error');
            setErrorMessage('Read timeout');
            reject(new Error('Read timeout'));
          }
        }, READ_TIMEOUT_MS);

        if (inputRef.current) {
          inputRef.current.onmidimessage = (event: { data: unknown }) => {
            const data = getBytes(event.data);
            console.log('[GP-200] pull rx:', Array.from(data).map(b => b.toString(16).padStart(2,'0')).join(' '));
            onMidiMessage(event);
            if (isSysEx(data, 0x12, 0x18)) {
              chunks.push(data);
              if (chunks.length === 7) {
                clearTimeout(timer);
                if (inputRef.current) inputRef.current.onmidimessage = onMidiMessage;
                try {
                  const preset = SysExCodec.parseReadChunks(chunks);
                  presetNamesRef.current[slot] = preset.patchName;
                  presetStylesRef.current[slot] = preset.patchStyle;
                  setPresetNames([...presetNamesRef.current]);
                  setPresetStyles([...presetStylesRef.current]);
                  persistNames();
                  resolve(preset);
                }
                catch (e) { reject(e); }
              }
            }
          };
        }

        const req = SysExCodec.buildReadRequest(slot);
        console.log('[GP-200] pull tx:', Array.from(req).map(b => b.toString(16).padStart(2,'0')).join(' '));
        outputRef.current!.send(req);
      }

      tryRequest();
    });
  }, [onMidiMessage, pauseNameLoading, persistNames]);

  const pushPreset = useCallback(async (preset: GP200Preset, slot: number): Promise<GP200Preset> => {
    await pauseNameLoading();
    if (!outputRef.current) throw new Error('Not connected');
    console.log(`[GP-200] push: slot=${slot} (${SysExCodec.slotToLabel(slot)}) name="${preset.patchName}"`);

    // The experimental chunk-upload path could be silently discarded by the
    // pedal. Use the live-edit + save-commit sequence verified on hardware.
    // Mute write echoes while the multi-second operation is in flight.
    suppressFxFor(30_000);
    suppressSlotEchoUntilRef.current = Date.now() + 30_000;
    await writePresetLive(preset, slot, (message) => outputRef.current!.send(message));

    // Do not claim the supported patch fields were written until readback
    // confirms them. EXP assignments are reported separately by callers:
    // the live bulk writer deliberately leaves those target-slot settings alone.
    let readback: GP200Preset;
    try {
      readback = await pullPreset(slot);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not verify the write to ${SysExCodec.slotToLabel(slot)}: ${detail}. The device slot may have changed.`);
    }
    const mismatch = presetWriteMismatch(preset, readback);
    if (mismatch) {
      throw new Error(`The write to ${SysExCodec.slotToLabel(slot)} was incomplete: ${mismatch}. The device slot may have changed.`);
    }
    setCurrentSlot(slot); currentSlotRef.current = slot;

    console.log('[GP-200] push core fields verified');
    return readback;
  }, [pauseNameLoading, suppressFxFor, pullPreset]);

  const saveToSlot = useCallback(async (presetName: string, slot?: number, style?: number): Promise<void> => {
    if (!outputRef.current) return;
    // Save-commit persists the device's current editing buffer to flash.
    // Live edits (toggle, param, reorder) already updated the editing buffer.
    // Valeton flow: save-commit → preset-change (re-select slot to confirm).
    // decoded[4] must be the sub-slot index (A=0,B=1,C=2,D=3); otherwise device saves to wrong slot!
    const targetSlot = slot ?? currentSlotRef.current ?? 0;
    const msg = SysExCodec.buildSaveCommit(presetName, targetSlot);
    console.log(`[GP-200] save-commit: name="${presetName}" slot=${targetSlot} (sub=${targetSlot % 4})`);
    outputRef.current.send(msg);
    // Wait for device to write to flash
    await new Promise(r => setTimeout(r, 300));
    presetNamesRef.current[targetSlot] = presetName;
    if (style !== undefined) presetStylesRef.current[targetSlot] = style;
    setPresetNames([...presetNamesRef.current]);
    setPresetStyles([...presetStylesRef.current]);
    persistNames();
  }, [persistNames]);

  const writePresetToSlot = useCallback(async (preset: GP200Preset, slot: number): Promise<void> => {
    await pushPreset(preset, slot);
  }, [pushPreset]);

  /** Request one slot's name. Fast path (sub=0x20 name-only read, fw 1.8.0)
   *  when useFast; full 7-chunk read request otherwise. Either way the
   *  first sub=0x18 chunk with offset 0 carries the name. */
  const requestSlotName = useCallback(
    (slot: number, useFast: boolean, timeoutMs: number): Promise<string | null> => {
      return new Promise<string | null>((resolve) => {
        let settled = false;
        let name: string | null = null;
        const responseOffsets = new Set<number>();
        const finish = (result: string | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (inputRef.current) inputRef.current.onmidimessage = onMidiMessage;
          resolve(result);
        };
        const timer = setTimeout(() => {
          // If offset zero arrived, the name itself is valid even when a tail
          // chunk went missing. The timeout still gives the remaining response
          // time to drain before the next slot request begins.
          finish(name);
        }, timeoutMs);
        if (inputRef.current) {
          inputRef.current.onmidimessage = (event: { data: unknown }) => {
            const data = getBytes(event.data);
            onMidiMessage(event);
            // Preset/name chunks are substantially larger than the 62-byte
            // live parameter-write echoes that share this command/subcommand.
            if (isSysEx(data, 0x12, 0x18) && data.length > 100) {
              // Preset-read response offsets are ordinary 16-bit LE (unlike
              // the 7-bit split used by host-to-device upload chunks).
              const off = data[11] | (data[12] << 8);
              responseOffsets.add(off);
              if (off === 0) {
                name = SysExCodec.parsePresetName(data);
                const style = SysExCodec.parsePresetStyle(data);
                if (style !== null) presetStylesRef.current[slot] = style;
              }
              // A full read produces seven chunks. Waiting for all of them is
              // essential: sending the next slot request after only offset 0
              // overlaps six still-streaming chunks and eventually wedges the
              // pedal's MIDI response queue.
              if (isPresetNameResponseComplete(useFast, responseOffsets)) finish(name);
            }
          };
        }
        let req: Uint8Array;
        if (useFast) req = SysExCodec.buildNameReadRequest(slot);
        else req = SysExCodec.buildReadRequest(slot);
        try {
          outputRef.current!.send(req);
        } catch {
          // A disconnected/closed port must behave like a bounded timeout, not
          // reject the scan and leave namesLoadRunningRef stuck forever.
          finish(null);
        }
      });
    },
    [onMidiMessage],
  );

  const loadPresetNames = useCallback(async (): Promise<void> => {
    if (!outputRef.current || !inputRef.current) return;
    if (namesLoadRunningRef.current) return; // already running
    namesLoadRunningRef.current = true;
    namesLoadAbortRef.current = false;
    const FULL_TIMEOUT = 1500; // allow all 7 chunks to drain on slower USB hosts
    const FAST_TIMEOUT = 250; // single-chunk response, fail over quickly
    const BATCH_SIZE = 8;     // Update UI every 8 slots instead of every slot

    // Progress is slots examined, not names received. A completed scan with a
    // few transient misses must not look permanently stuck at (say) 12/256.
    setNamesLoadProgress(0);
    try {
      for (let s = 0; s < 256; s++) {
        if (namesLoadAbortRef.current) break;
        if (presetNamesRef.current[s] === null || presetStylesRef.current[s] === null) {
          const result = await readPresetNameReliably(
            fastNameReadRef.current,
            () => requestSlotName(s, true, FAST_TIMEOUT),
            () => requestSlotName(s, false, FULL_TIMEOUT),
            () => namesLoadAbortRef.current,
          );
          fastNameReadRef.current = result.fastSupported;
          if (namesLoadAbortRef.current) break;
          // A timeout is not a name. Keep the slot missing so REFRESH can retry
          // it, while progress still advances because this pass did examine it.
          if (result.name !== null) presetNamesRef.current[s] = result.name;
          // Give the pedal a small inter-request gap after its final chunk.
          await new Promise(r => setTimeout(r, 20));
        }
        // Batch UI updates: only re-render every BATCH_SIZE slots or on the last slot
        if ((s + 1) % BATCH_SIZE === 0 || s === 255) {
          setPresetNames([...presetNamesRef.current]);
          setPresetStyles([...presetStylesRef.current]);
        }
        setNamesLoadProgress(s + 1);
      }
    } finally {
      // Final flush and handler restoration happen even if a port closes or a
      // parser unexpectedly throws, so a later REFRESH can always start again.
      setPresetNames([...presetNamesRef.current]);
      setPresetStyles([...presetStylesRef.current]);
      if (inputRef.current) inputRef.current.onmidimessage = onMidiMessage;
      namesLoadRunningRef.current = false;
      persistNames();
    }
  }, [onMidiMessage, requestSlotName, persistNames]);

  // Force-read every slot and correct any that drifted from the cache-seeded
  // values. Runs silently in the background after a cache hit; the Patch
  // Manager already shows cached names, so this only patches in differences.
  // Shares the run/abort refs with loadPresetNames (both hijack
  // input.onmidimessage, so they must never run concurrently) and is aborted by
  // pauseNameLoading / disconnect.
  const syncPresetNames = useCallback(async (): Promise<void> => {
    if (!outputRef.current || !inputRef.current) return;
    if (namesLoadRunningRef.current) return; // a scan is already running
    namesLoadRunningRef.current = true;
    namesLoadAbortRef.current = false;
    setNamesSyncing(true);
    const FULL_TIMEOUT = 1500;
    const FAST_TIMEOUT = 250;

    try {
      for (let s = 0; s < 256; s++) {
        if (namesLoadAbortRef.current) break;
        const previousStyle = presetStylesRef.current[s];
        const result = await readPresetNameReliably(
          fastNameReadRef.current,
          () => requestSlotName(s, true, FAST_TIMEOUT),
          () => requestSlotName(s, false, FULL_TIMEOUT),
          () => namesLoadAbortRef.current,
        );
        const name = result.name;
        fastNameReadRef.current = result.fastSupported;
        if (namesLoadAbortRef.current) break;
        // A null read is a transient miss (timeout), so keep the cached value rather
        // than blanking a slot we already have a good name for.
        if (name !== null && name !== presetNamesRef.current[s]) {
          presetNamesRef.current[s] = name;
          setPresetNames([...presetNamesRef.current]);
        }
        if (presetStylesRef.current[s] !== previousStyle) {
          setPresetStyles([...presetStylesRef.current]);
        }
        await new Promise(r => setTimeout(r, 20));
      }
    } finally {
      if (inputRef.current) inputRef.current.onmidimessage = onMidiMessage;
      namesLoadRunningRef.current = false;
      setNamesSyncing(false);
      // A foreground action can abort after the first chunk supplied a style
      // but before the full name response drained. Keep that valid metadata.
      setPresetStyles([...presetStylesRef.current]);
      persistNames();
    }
  }, [onMidiMessage, requestSlotName, persistNames]);

  const refreshNames = useCallback(async (): Promise<void> => {
    await pauseNameLoading();
    // Keep the names the handshake already pulled (current bank); those came
    // from full reads moments ago; clear everything else for re-enumeration.
    const bankBase = (() => {
      if (currentSlotRef.current === null) return -1;
      return Math.floor(currentSlotRef.current / 4) * 4;
    })();
    for (let s = 0; s < 256; s++) {
      const inCurrentBank = bankBase >= 0 && s >= bankBase && s < bankBase + 4;
      if (!inCurrentBank) {
        presetNamesRef.current[s] = null;
        presetStylesRef.current[s] = null;
      }
    }
    setPresetNames([...presetNamesRef.current]);
    setPresetStyles([...presetStylesRef.current]);
    setNamesLoadProgress(0);
    await loadPresetNames();
  }, [pauseNameLoading, loadPresetNames]);

  const renameSlot = useCallback(async (slot: number, name: string): Promise<void> => {
    await pauseNameLoading();
    if (!outputRef.current) throw new Error('Not connected');
    const output = outputRef.current;
    const previousSlot = currentSlotRef.current;
    // Preset-change loads the slot into the device's editing buffer; the
    // save-commit then persists that buffer under the new name. Effect data
    // is untouched because nothing else was edited in between.
    output.send(SysExCodec.buildPresetChange(slot));
    await new Promise(r => setTimeout(r, 200));
    // Gap C experiment (docs §2b): the device ignores the name inside
    // save-commit, so renames don't persist. Behind the debug flag, try the
    // hypothesized single-field name write first; the save-commit then
    // persists the edit buffer it (hopefully) just changed.
    if (isNameWriteEnabled()) {
      output.send(SysExCodec.buildPatchName(name));
      await new Promise(r => setTimeout(r, 150));
    }
    output.send(SysExCodec.buildSaveCommit(name, slot));
    await new Promise(r => setTimeout(r, 300));
    presetNamesRef.current[slot] = name;
    setPresetNames([...presetNamesRef.current]);
    persistNames();
    setCurrentSlot(slot); currentSlotRef.current = slot;
    if (previousSlot !== null && previousSlot !== slot) {
      output.send(SysExCodec.buildPresetChange(previousSlot));
      await new Promise(r => setTimeout(r, 200));
      setCurrentSlot(previousSlot); currentSlotRef.current = previousSlot;
    }
  }, [pauseNameLoading, persistNames]);

  // Bulk apply: write the same CTRL assignments and/or patch volume into many
  // saved patches. Per slot this replays the proven renameSlot sequence —
  // preset-change loads the slot into the edit buffer, live writes mutate it,
  // save-commit persists it , so it inherits that path's hardware guarantees
  // (and its caveats: CTRL mask bit 7/MOD does not apply live, docs §3).
  const bulkApplyAbortRef = useRef(false);
  const [bulkApplyProgress, setBulkApplyProgress] = useState<BulkApplyProgress | null>(null);

  const cancelBulkApply = useCallback(() => {
    bulkApplyAbortRef.current = true;
  }, []);

  const bulkApply = useCallback(async (
    slots: number[],
    options: BulkApplyOptions,
  ): Promise<{ done: number; cancelled: boolean }> => {
    await pauseNameLoading();
    if (!outputRef.current) throw new Error('Not connected');
    const output = outputRef.current;
    const previousSlot = currentSlotRef.current;
    bulkApplyAbortRef.current = false;
    let done = 0;

    try {
      for (const slot of slots) {
        if (bulkApplyAbortRef.current) break;
        setBulkApplyProgress({ done, total: slots.length, slot });
        // Long enough to cover every frame this iteration sends, so the FX
        // dispatcher can't mistake device echoes for hardware-initiated edits.
        suppressFxFor(1200);
        output.send(SysExCodec.buildPresetChange(slot));
        await new Promise(r => setTimeout(r, 200));

        if (options.volume !== undefined) {
          output.send(SysExCodec.buildPatchSetting(0x00, options.volume));
          await new Promise(r => setTimeout(r, 30));
        }
        if (options.ctrlAssignments) {
          for (const assignment of options.ctrlAssignments) {
            output.send(SysExCodec.buildCtrlAssignment(
              assignment.ctrlIndex,
              assignment.blockMask,
              assignment.state,
            ));
            await new Promise(r => setTimeout(r, 30));
          }
        }

        // The device ignores the name field in save-commit (docs §2b), so a
        // cached name is cosmetic; the buffer's own name is what persists.
        output.send(SysExCodec.buildSaveCommit(presetNamesRef.current[slot] ?? '', slot));
        await new Promise(r => setTimeout(r, 300));
        done++;
        setBulkApplyProgress({ done, total: slots.length, slot });
      }
    } finally {
      setBulkApplyProgress(null);
      if (previousSlot !== null) {
        output.send(SysExCodec.buildPresetChange(previousSlot));
        await new Promise(r => setTimeout(r, 200));
        setCurrentSlot(previousSlot); currentSlotRef.current = previousSlot;
      }
    }
    return { done, cancelled: bulkApplyAbortRef.current };
  }, [pauseNameLoading, suppressFxFor]);

  // All send* helpers + device-callback setters come from useMidiSend (see
  // the top of the hook where `send` is instantiated). The return value at
  // the bottom spreads them onto the public API.

  // Track connection state for auto-reconnect
  useEffect(() => {
    if (status === 'connected') {
      wasConnectedRef.current = true;
      reconnectAttemptsRef.current = 0;
    }
  }, [status]);

  // Auto-reconnect when connection drops (USB replug, page navigation)
  useEffect(() => {
    if (status === 'disconnected' && wasConnectedRef.current && reconnectAttemptsRef.current < 3) {
      reconnectTimerRef.current = setTimeout(() => {
        reconnectAttemptsRef.current++;
        console.log(`[GP-200] auto-reconnect attempt ${reconnectAttemptsRef.current}/3`);
        connect();
      }, 2000);
    }
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [status, connect]);

  return {
    status, handshakeStep, errorMessage, deviceName, currentSlot, presetNames, presetStyles, namesLoadProgress,
    namesSyncing,
    deviceInfo, currentPreset, userIrNames, deviceState,
    connect, disconnect, loadPresetNames, syncPresetNames, refreshNames,
    pullPreset, pushPreset, writePresetToSlot, saveToSlot, renameSlot,
    bulkApply, bulkApplyProgress, cancelBulkApply,
    // Send operations + device-callback registration are owned by useMidiSend.
    sendEffectChange: send.sendEffectChange,
    sendToggle: send.sendToggle,
    sendParamChange: send.sendParamChange,
    sendReorder: send.sendReorder,
    sendFxLoopMove: send.sendFxLoopMove,
    sendSlotChange: send.sendSlotChange,
    sendAuthor: send.sendAuthor,
    sendStyleName: send.sendStyleName,
    sendNote: send.sendNote,
    sendPatchVolume: send.sendPatchVolume,
    sendPatchPan: send.sendPatchPan,
    sendPatchTempo: send.sendPatchTempo,
    sendExpParamSelect: send.sendExpParamSelect,
    sendExpMinMax: send.sendExpMinMax,
    sendCtrlAssignment: send.sendCtrlAssignment,
    sendFsMode: send.sendFsMode,
    sendFsTarget: send.sendFsTarget,
    sendFsCombo: send.sendFsCombo,
    sendAutoCabMatch: send.sendAutoCabMatch,
    sendCC: send.sendCC,
    ccChannel: send.ccChannel,
    setCcChannel: send.setCcChannel,
    sendRawChunks: send.sendRawChunks,
    setOnDeviceChange: send.setOnDeviceChange,
    setOnDeviceToggle: send.setOnDeviceToggle,
    setOnDeviceEffectChange: send.setOnDeviceEffectChange,
    setOnDeviceParamChange: send.setOnDeviceParamChange,
    setOnFootswitch: send.setOnFootswitch,
    setOnExpPosition: send.setOnExpPosition,
    setOnLooperFrameTap: send.setOnLooperFrameTap,
  };
}
