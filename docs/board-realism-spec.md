# Board realism pass — spec (branch `library`)

Goal: the pedals, amps and cabs on the pedalboard should look like the hardware they model — enclosure shape, size class, colour, panel, grille — not the uniform grey stompbox chassis every block uses today. No brand names, logos or wordmarks anywhere (the existing rule: colours, proportions, control layout only; captions keep the existing "Based on …" text that already lives in the manifest).

## What exists
- `scripts/pedal-art-specs.mjs` — per-effect spec: template `t` (`stomp` | `mxr` (via stomp shape) | `rocker` | `eq` | `amp` | `cab` | `acoustic` | `rack` | `tape` | `util`), body/tolex/panel/grille/piping/knob colours, knob counts, labels, `basedOn`.
- `scripts/generate-pedal-art.mjs` — turns specs into `public/pedals/*.svg` (160×64 thumbnails used by the effect picker + info strip) and `public/pedals/manifest.json` (incl. `colors`).
- `src/components/board/Pedal.tsx` + `board.css` — the on-board block. Today: one enclosure style for everything; only body/ink/led colours and an optional amp "panel" strip come from the manifest. Knobs = `PedalKnob.tsx`, faders for EQ = `PedalFader.tsx`, footswitch = `.treadle` / `.stomp-round`. Layout constraints: fixed bays (`boardLayout.ts`, `pedalIsWide`), FLIP reorder animation keyed by `data-flip-id`, drag-and-drop, the two-row desktop board and the single-row ≤720px board, phone tree under `components/mobile/` (do NOT change the phone tree).

## Deliverable
1. **Manifest carries the template + look.** Extend `generate-pedal-art.mjs` so each manifest entry also exports a `look` object the board can render from: `{ template, shape?, tolex?, grille?, piping?, panel?, panelText?, knobColor?, lamp?, cols?, rows?, size?, wood?, label }` — i.e. the spec fields, normalised (pattern names for tolex/grille, hex for colours). Keep `colors` as-is for backwards compatibility. Bump the service-worker cache name in `public/sw.js` if the manifest shape is cached.
2. **Board chassis per template** in `Pedal.tsx`/`board.css` (add a `PedalChassis` component or per-template class + CSS vars; keep Pedal.tsx readable):
   - `stomp` (default): current enclosure, but honour `shape` (`mxr` = smaller squat box with a single round stomp, no plate; standard = current), `plate` false/true, and knob colour (`dark` / `cream` / `gold` via existing `KNOB_STYLES` if present, else add).
   - `rocker` (wah, volume, pitch bend): treadle-style enclosure — wedge/rocker silhouette, one rubber treadle top, metal-grey body per spec.
   - `eq`: rack-ish slim box with faders (exists) — add a brushed panel look.
   - `amp`: **amp head**: tolex body (pattern: black / tweed / etc. via CSS pattern or inline SVG `<pattern>`), a control panel strip with the real panelText/panel colours, pilot lamp (`lamp` colour, lit when enabled), piping line, and a short grille strip below the panel using the `grille` pattern. Knobs sit on the panel. Wider than a stomp (already `wide` for AMP in `pedalIsWide`? check; keep bays consistent).
   - `cab`: **speaker cabinet**: tolex box, full-face grille cloth in the spec pattern (blackweave / silverface / oxblood / cane / diamond / metalgrid / tweed…), `cols×rows` speaker circles drawn in the grille (1×8, 1×12, 2×12, 4×12, 4×10, 8×10…), size label from `size`, piping. Its three knobs (Volume/Low Cut/High Cut) go in a small strip at the bottom like a back-panel plate.
   - `acoustic` (acoustic IR cabs): a guitar-body silhouette in the `wood` colour with a soundhole; knobs in a strip.
   - `rack` (rack delays/reverbs): 1U rack face — dark faceplate, rack ears, LED display block, knobs in a row.
   - `tape` (tape echoes): tape-machine face — two reels drawn (CSS/SVG), VU-style meter, knobs beneath.
   - `util` (Valeton originals / SnapTone / User IR): current flat module card look with the motif glyph, fine as is.
   Patterns: implement grille/tolex textures once as reusable inline SVG `<pattern>` defs or CSS gradients (a `patterns.tsx` helper), matching what `patternDefs()` does in the generator so thumbnails and board agree.
3. **Bypassed state** still dims/desaturates; enabled LED / pilot lamp lights up. Keep drag handles, info dot, pin, move buttons, footswitch hit-areas exactly where they are functionally (tests in `tests/unit/PedalBoard.test.tsx` and any Pedal tests must pass unchanged or be updated only for class names).
4. **Fix**: `Dark Twin` (and any other slug-collision effect: `Tube`, `SnapTone`) — the board/picker must resolve `dark-twin--amp.svg` / `--cab`; verify `lookupPedalArt` + manifest `file` are right for both (the AMP one rendered as a broken image in a test page; find out why — likely the manifest `file` for one of the pair is wrong).
5. **Docs**: update `docs/board-design-system.md` (templates, patterns, the look object) and add a short section to README under "Every block is a pedal".
6. Quality bar: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` green; regenerate art (`node scripts/generate-pedal-art.mjs`) and commit the regenerated `public/pedals/` output. Take Playwright screenshots (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `npx vite build && npx vite preview --port 4174`, click "OPEN WITHOUT CONNECTING") of the default INIT patch and of a patch using UK SLP + UK GRN 2 + O-Phase + Tape + Room (load `ref/fixtures/ATBL Rhythm.prst` via the PATCHES sheet's file import, or dispatch it through whatever loadPreset path the tests use) at 1500×900 and at 1000×700, save to `docs/screens/board-realism-*.png`, and look at them: every block must be legible, nothing overlaps, the two-row layout still fits.

## Non-goals
Phone tree, animations beyond what exists, new effect artwork thumbnails beyond regeneration, any brand text.
