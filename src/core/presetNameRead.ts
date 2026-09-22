/**
 * Read one preset name without letting a transient failure in the optional
 * fast command turn into a permanently blank patch-manager row.
 *
 * `fastSupported` is connection-scoped: null means unprobed, true means a
 * previous fast read worked, and false means use the full preset read. Even
 * after a successful probe, an individual fast timeout falls back to the
 * full read; USB MIDI can drop a response without invalidating the command.
 */
export async function readPresetNameReliably(
  fastSupported: boolean | null,
  readFast: () => Promise<string | null>,
  readFull: () => Promise<string | null>,
  isAborted: () => boolean = () => false,
): Promise<{ name: string | null; fastSupported: boolean | null }> {
  if (fastSupported === false) {
    return { name: await readFull(), fastSupported: false };
  }

  const fastName = await readFast();
  if (fastName !== null) {
    return { name: fastName, fastSupported: true };
  }
  if (isAborted()) return { name: null, fastSupported };

  const fullName = await readFull();
  // A failed first probe followed by a successful full read means this
  // firmware does not implement the name-only request. If fast reads worked
  // earlier, retain that knowledge: this one miss was likely transient and
  // future slots may still use the quicker command.
  const nextSupport = fastSupported === null && fullName !== null
    ? false
    : fastSupported;
  return { name: fullName, fastSupported: nextSupport };
}

/**
 * A name-only read is one response chunk, but the fallback command asks the
 * pedal for the whole preset.  Do not start another request until all seven
 * chunks from that full response have drained from the MIDI port.  Otherwise
 * the tail of slot N can overlap the request/response for slot N+1 and, on
 * hardware, eventually overrun the device's very small MIDI queue.
 */
export function isPresetNameResponseComplete(
  useFastRead: boolean,
  responseOffsets: ReadonlySet<number>,
): boolean {
  if (!responseOffsets.has(0)) return false;
  return useFastRead || responseOffsets.size >= 7;
}
