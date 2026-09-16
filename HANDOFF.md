# Handoff — funkdialout/gp200-studio (fork of kabir0st/gp200-studio)

Read this first if you are an agent or person picking up the fork. Owner: Rob (funkdialout).
Upstream: https://github.com/kabir0st/gp200-studio (GPL-3.0). Work branch: `library`. Do not
push to upstream; PRs to upstream only for the protocol fixes below, if Rob asks.

## What the fork adds (all on `library`)
1. **Preset library + bulk load** — `src/components/LibrarySheet.tsx`, `src/core/library.ts`,
   `src/core/libraryStore.ts` (IndexedDB). Spec: `docs/library-spec.md`. LIBRARY button in
   `BoardTopBar`. Write path = existing `midiDevice.pushPreset` (flash upload); optional
   read-back verify via `pullPreset` + `verifyWrite`.
2. **Layout flapping fix** — `useIsPhone` hysteresis + `scrollbar-gutter: stable`
   (`src/hooks/useMediaQuery.ts`, `src/index.css`).
3. **Board realism** — per-template chassis on the pedalboard (stomp/mxr/rocker/eq/amp/cab/
   acoustic/rack/tape/util). Spec: `docs/board-realism-spec.md`; design notes:
   `docs/board-design-system.md`; code: `src/components/board/{PedalChassis.tsx,chassisLook.ts,
   patterns.ts}`, `Pedal.tsx`, `board.css`; the generator (`scripts/generate-pedal-art.mjs`) now
   emits a `look` object per manifest entry. No brand names/logos are drawn; the "Based on …"
   caption text comes from upstream's manifest.

## Protocol facts learned on real hardware (fw 1.8.2, editor V1.8.1) — not all in upstream
- Effect-change (sub 0x14): the effect-ID **sub-category byte** (bits 16–23; 0x10 = User IR cab)
  is nibble-encoded at raw[49], raw[50]. Upstream's `buildEffectChange` still zeroes it, so a
  per-parameter write of a preset with a User IR cab lands with a stock cab. The flash-upload
  path (`pushPreset`, sub 0x20 chunks) does not have this problem. Fix candidate for upstream.
- Per-parameter writes: send switch/menu params (Sync, Trail, …) **before** knobs; a Sync
  message after Time/Rate resets those knobs to defaults.
- Read request (sub 0x10) returns **flash**, not the edit buffer: save-commit before verifying.
- 1176-byte third-party .prst files write fine; their author field is often junk → send empty.
- Windows: one process owns the USB-MIDI port. Reaper, Valeton's editor, or another browser
  profile holding the port makes Web MIDI time out. Python + mido/python-rtmidi (WinMM) worked.
- Reference scripts (hardware-verified today): `B:\MegaSync\FunkDocs\AI-Projects\Valeton\tools\
  gp200_probe.py` (read slot), `gp200_write.py <prst> <slot0>` (write + verify),
  `push_batch2.ps1`. Slot 0-based: 40-A = 156, 64-C = 254.

## Environment notes (Rob's PC "rr-desktop")
- Global `NODE_ENV=production` → `npm install --include=dev`; `npm run dev` (Vite/React
  refresh) breaks with `$RefreshSig$ is not defined`; use `npm run build && npx vite preview
  --port 4173 --strictPort` instead, or run dev with `$env:NODE_ENV="development"`.
- npm 12 blocks esbuild's postinstall script (`npm install-scripts approve esbuild` if needed).
- Clone: `B:\MegaSync\FunkDocs\AI-Projects\gp200-studio`. Sibling reference project
  `B:\MegaSync\FunkDocs\AI-Projects\gp200-librarian` (standalone Vite app, superseded).
- Third-party preset packs: `B:\MegaSync\FunkDocs\Jam Session\Valeton\Packs\GP-200\Valeton GP200`
  — 755 .prst (514 × 1176 B, 241 × 1224 B), 436 IR .wav; 573 presets reference User IR slots.
  Never commit these (no redistribution rights).

## Open items / next steps
- Hardware-test the LIBRARY sheet end to end in Chrome (last attempt: MIDI response timeout,
  port held by another app). Suggested first test: two presets → 64-A/64-B with verify on.
- IR (.wav → 20 User IR slots) and NAM/.clo (SnapTone) upload over SysEx: protocol unknown;
  needs a USB capture of Valeton's editor (`scripts/gp200-capture-gui.py` in phash/gp200editor,
  USBPcap) and verification. Most valuable remaining feature given the IR-heavy packs.
- Mobile tab for LIBRARY (desktop button only today).
- Upstream PRs: sub-category byte fix; switch-before-knob ordering.
- Artist presets so far (in Valeton\output, on the pedal): 40-A/B/C ATBL rhythm/lead/bass,
  41-A/B/C Creep rhythm/lead/bass; recipes in Valeton\recipes → analysis/build_preset.py.

## Commands
```
npm install --include=dev
npm run typecheck && npm run lint && npm run test
npm run build && npx vite preview --port 4173 --strictPort   # Chrome/Edge → http://localhost:4173
node scripts/generate-pedal-art.mjs                          # regenerate public/pedals/
```
