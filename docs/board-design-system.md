# Board design system

How the pedalboard view (`src/components/board/`) draws the chain. The phone
tree (`src/components/mobile/`) has its own layout and only shares the artwork
thumbnails and the manifest.

## Sources of truth

| What | Where |
| --- | --- |
| Effect list (name, module, id) | `src/core/effectNames.ts` |
| Per-effect look (template, colours, grille, knobs, "Based on") | `scripts/pedal-art-specs.mjs` |
| Grille-cloth / tolex textures | `src/components/board/patterns.ts` |
| Thumbnails + manifest | `scripts/generate-pedal-art.mjs` → `public/pedals/*.svg`, `public/pedals/manifest.json` |
| Module fallback palette, knob caps | `src/components/board/boardPalette.ts` |
| Bay sizes (wide / compact) | `src/components/board/boardLayout.ts` |

Regenerate after touching a spec or a pattern:

```sh
node scripts/generate-pedal-art.mjs
```

The manifest is fetched at runtime (not bundled) and served
stale-while-revalidate by `public/sw.js`; bump the worker's `VERSION` whenever
the manifest *shape* changes, and keep the board working for an entry that lacks
a new field.

## Rules

- **No brand names, logos or wordmarks on any artwork or pedal.** The look is
  colour, proportion and control layout only. The real hardware is named in one
  place: the manifest's `basedOn` caption ("Based on …").
- The spec `label` (model-style shorthand such as the thumbnail's panel text) is
  exported in `look.label` but never printed on the board. The board prints the
  Valeton effect name.
- Colour a pedal only through CSS custom properties set inline by `Pedal.tsx`
  (`--body`, `--body-deep`, `--ink`, `--led`, plus the look variables below).
  Text on a surface uses that surface's ink: `--ink` on the body, `--panel-text`
  on an amp panel, dark ink on a cab's back plate.

## File naming

Slug = name lowercased, `+` → ` plus`, every other non-alphanumeric run → `-`.
When two effects in different modules share a slug the file gets a module
suffix: `dark-twin--amp.svg` / `dark-twin--cab.svg`, `tube--dst.svg` /
`tube--dly.svg`, `snaptone--amp.svg` / `snaptone--dst.svg`.

Never build an artwork URL from `slug`: always use the entry's `file`
(`pedalArtUrl(entry)`), found with `lookupPedalArt(index, effectId)`, which keys
by module + name. A slug-only URL for a colliding effect is not a file, and the
static host's fallback answers it with HTML, which an `<img>` shows as a broken
image.

## Manifest entry

```jsonc
{
  "name": "UK 800", "module": "AMP", "slug": "uk-800", "file": "uk-800.svg",
  "type": "Drive Amp", "basedOn": "…", "blurb": "…",
  "colors": { "body", "bodyDeep", "ink", "knob", "led", "panel?", "panelText?" },
  "look":   { "template": "amp", "label": "…", /* template fields, below */ },
  "art":    { "x": 6, "w": 148 }   // thumbnail content box (phone crops to it)
}
```

`colors` is unchanged for older readers. `look` (type `PedalLook` in
`pedalManifest.ts`) holds only the fields its template uses. Colours are hex;
`tolex`, `grille` and `panel` may be a pattern name from `patterns.ts`. `knob`
is the knob-cap style (`dark` / `cream` / `gold`, see `KNOB_STYLES`) for the
surface the knobs actually sit on.

## Chassis templates

`Pedal.tsx` renders the same DOM for every block: grip, jacks, screws, module
chip, info dot, chain number, controls, LED, name, caption, footswitch, move
buttons. The article gets `tpl-<template>` (and `shape-<shape>` for stomps), and
`PedalChassis.tsx` adds decoration in two places:

- **`ChassisSkin`**: an absolutely positioned layer painted behind the content
  (the article is `isolation: isolate`, the skin `z-index: -1`): tolex, rack
  ears, the amp handle.
- **`ChassisFace`**: in-flow panels before or after the controls: cab grille,
  instrument body, tape deck, rack readout, amp grille strip.

Everything it draws is `aria-hidden` with no pointer events, so hit areas, drag
and drop and the FLIP reorder (`data-flip-id`) are untouched. The non-visual
helpers (template → classes, CSS variables, footswitch kind, knob ink) live in
`chassisLook.ts`.

| Template | Used for | Look fields | Board rendering |
| --- | --- | --- | --- |
| `stomp` | most drives, modulation, some delays | `shape` (`standard` / `mxr` / `big` / `round`), `plate`, `knob` | Standard enclosure with a footswitch plate. `mxr`: 150px squat box, tight corners, round stomp, no plate. `big`: squarer corners. `round`: domed top, chips dropped under the curve, round stomp. |
| `rocker` | wahs, volume, pitch treadle | `knob` | Cast body tapering to the toe (clip-path, scrim follows it), controls on the toe, one tall ribbed rubber treadle hinged at the heel. |
| `eq` | graphic EQs | `bands`, `sliderColor`, `knob` | Slim box, brushed face, faders in a recessed slot panel. |
| `amp` | amp heads | `tolex`, `panel`, `panelText`, `grille`, `piping`, `knobColor`, `knob`, `lamp`, `face?` | Tolex box with a handle and corner protectors; knobs on the control-panel strip (colour or diamond-plate pattern); jewel pilot lamp in the panel, lit when enabled; grille-cloth strip edged in piping. |
| `cab` | speaker cabinets | `tolex`, `grille`, `piping`, `cols`, `rows`, `size`, `cone?`, `exposed?`, `knob` | Tolex box; full-width grille cloth with `cols × rows` speakers (cell size capped so a 4×12 or 8×10 stays short) and the `size` tag; Volume / Low Cut / High Cut on a brushed back-panel plate. Jacks sit level with the grille. |
| `acoustic` | acoustic body IRs | `shape`, `wood`, `knob` | Dark case lining, the instrument body in its wood colour (soundhole or f-holes), knobs on a dark strip. |
| `rack` | rack delays, bass preamp | `display`, `displayColor`, `knob` | 1U faceplate with slotted rack ears, an LED readout (lit when enabled) and vents, knobs in a row. |
| `tape` | tape / drum echoes | `kind` (`reels` / `drum`), `panel`, `knob` | Deck panel with two reels (or the echo drum) and a VU meter (two when wide); the needle rests on its peg while bypassed. |
| `util` | Valeton originals, NAM, User IR | `motif`, `knob` | The flat module card (unchanged). |

A manifest without `look` draws `stomp` (with the old amp panel strip when
`colors.panel` is present).

### Width

Bays are fixed per module (`isWideSlot`): 310px wide, 172px compact. A pedal is
wide when its bay is wide and either it has five or more knobs or its template
is landscape by nature (`amp`, `rack`, see `pedalIsWide`). The bay already
reserves the width, so this moves nothing on the desktop board; the tablet band
(bays hug their pedal) sees the extra width. Tape decks stay compact unless the
effect is knob-heavy.

### Footswitch

`.treadle` for `stomp` with a plate, `rocker`, and compact `eq` / `util`;
`.stomp-round` (inside `.fs-row`) for every other template, squat and round
stomps, and any wide pedal.

### Bypass

The article's `::after` scrim and the BYPASSED tag, as before. Lamps, LEDs,
the rack readout and the VU needle read the enabled state.

## Patterns

`patterns.ts` holds one tile per texture (`PATTERN_TILES`) and a flat
representative colour (`PATTERN_HEX`). The generator imports it directly (Node
strips the types, so the file stays dependency-free and erasable-syntax only)
and writes `<pattern>` fills into the thumbnails; the board renders the same
tiles as inline SVG patterns at 1.6× scale.

Tolex: `tweed`, `bluecheck`, `orangeweave`. Panel: `diamondplate`. Grille:
`blackweave`, `silverface`, `oxblood`, `wheat`, `diamond`, `cane`, `basket`,
`metalgrid`.
