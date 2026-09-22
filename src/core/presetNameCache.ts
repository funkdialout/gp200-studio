/**
 * localStorage cache for the GP-200's 256 slot names and saved style tags, so
 * the patch browsers can filter immediately on reconnect instead of waiting
 * for the background SysEx scan. This is the app's only browser-persistence layer; durable state
 * otherwise lives on the device flash or in downloaded .prst/.zip files.
 *
 * The device exposes no unique serial over MIDI, so the cache is keyed on the
 * generic deviceType byte + the MIDI port name (effectively one cache per
 * machine). Names and styles read back from the device are re-verified in the
 * background (see useMidiDevice.syncPresetNames), so a stale cache self-heals.
 *
 * All storage access is wrapped so that private-mode / quota / disabled-storage
 * failures degrade to "no cache" instead of throwing.
 */

export const TOTAL_SLOTS = 256;

/** Optional styles keep existing name-only v1 caches readable. */
const CACHE_VERSION = 1;

interface CacheEnvelope {
  v: number;
  updatedAt: number;
  names: (string | null)[];
  /** Optional for backward compatibility with existing name-only caches. */
  styles?: (number | null)[];
}

export function presetNameCacheKey(deviceType: number, portName: string | null): string {
  return `gp200:names:${deviceType}:${portName ?? 'unknown'}`;
}

/**
 * Read + validate a cached name list. Returns the 256-entry array on a hit, or
 * null on miss / malformed data / version mismatch / unavailable storage.
 */
export function loadCachedNames(key: string): (string | null)[] | null {
  return readCache(key)?.names ?? null;
}

/** A style can be unknown (null) or explicitly unstyled (0). */
export function loadCachedStyles(key: string): (number | null)[] | null {
  const styles = readCache(key)?.styles;
  if (!Array.isArray(styles) || styles.length !== TOTAL_SLOTS) return null;
  if (styles.some((value) => value !== null &&
    (!Number.isInteger(value) || value < 0 || value > 0xFFFF))) return null;
  return styles;
}

function readCache(key: string): CacheEnvelope | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const env = parsed as Partial<CacheEnvelope>;
  if (env.v !== CACHE_VERSION) return null;
  if (!Array.isArray(env.names) || env.names.length !== TOTAL_SLOTS) return null;
  for (const entry of env.names) {
    if (entry !== null && typeof entry !== 'string') return null;
  }
  return env as CacheEnvelope;
}

/** Persist names and, when available, styles. Swallows storage failures. */
export function saveCachedNames(
  key: string,
  names: (string | null)[],
  styles?: (number | null)[],
): void {
  const envelope: CacheEnvelope = {
    v: CACHE_VERSION,
    updatedAt: Date.now(),
    names,
    styles,
  };
  try {
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Private mode / quota exceeded / storage disabled: cache is best-effort.
  }
}
