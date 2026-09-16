/**
 * Grille-cloth and tolex textures, shared by the artwork generator and the board.
 *
 * One table, two consumers: scripts/generate-pedal-art.mjs imports this file
 * directly (Node strips the types) to write the `<pattern>` fills into the
 * thumbnails, and PedalChassis renders the same tiles as inline SVG patterns on
 * the board, so a 4×12's cloth in the effect picker and on the pedalboard are
 * the same weave.
 *
 * Deliberately dependency-free (no imports, erasable TypeScript only): that is
 * what lets the Node script load it without a build step.
 */

export interface PatternTile {
  /** tile width, in pattern units */
  w: number;
  /** tile height, in pattern units */
  h: number;
  /** rotation of the tile grid, degrees */
  rotate?: number;
  /** inner SVG markup of one tile */
  body: string;
}

export const PATTERN_TILES: Record<string, PatternTile> = {
  // tolex
  tweed: {
    w: 6, h: 6, rotate: 45,
    body: '<rect width="6" height="6" fill="#c9a86a"/><rect width="6" height="3" fill="#b8945a"/><rect y="3" width="3" height="3" fill="#d8b878"/>',
  },
  bluecheck: {
    w: 8, h: 8, rotate: 45,
    body: '<rect width="8" height="8" fill="#28407c"/><rect width="8" height="4" fill="#1e3468"/><rect width="4" height="8" fill="rgba(255,255,255,.08)"/>',
  },
  orangeweave: {
    w: 5, h: 5,
    body: '<rect width="5" height="5" fill="#d86a1a"/><path d="M0 2.5 H5 M2.5 0 V5" stroke="#c05a10" stroke-width="1"/>',
  },
  diamondplate: {
    w: 10, h: 10,
    body: '<rect width="10" height="10" fill="#b0b4b8"/><ellipse cx="2.5" cy="2.5" rx="2" ry=".9" fill="#d0d4d8" transform="rotate(45 2.5 2.5)"/><ellipse cx="7.5" cy="7.5" rx="2" ry=".9" fill="#d0d4d8" transform="rotate(-45 7.5 7.5)"/>',
  },
  // grille cloth
  oxblood: {
    w: 4, h: 4,
    body: '<rect width="4" height="4" fill="#4a2028"/><circle cx="1" cy="1" r=".6" fill="#6a3038"/><circle cx="3" cy="3" r=".6" fill="#2e1418"/>',
  },
  silverface: {
    w: 5, h: 5,
    body: '<rect width="5" height="5" fill="#a8a49a"/><circle cx="1.2" cy="1.2" r=".7" fill="#c8c4ba"/><circle cx="3.6" cy="3.6" r=".7" fill="#8a867c"/>',
  },
  wheat: {
    w: 5, h: 5, rotate: 45,
    body: '<rect width="5" height="5" fill="#cfc0a0"/><rect width="5" height="2.4" fill="#bfae8c"/>',
  },
  diamond: {
    w: 8, h: 8, rotate: 45,
    body: '<rect width="8" height="8" fill="#5a4632"/><path d="M0 0H8V8H0Z" fill="none" stroke="#7a6248" stroke-width="1"/><circle cx="4" cy="4" r=".8" fill="#8a7250"/>',
  },
  cane: {
    w: 7, h: 7,
    body: '<rect width="7" height="7" fill="#c8a878"/><path d="M0 3.5 H7 M3.5 0 V7" stroke="#a8885c" stroke-width="1.6"/><path d="M0 0 L7 7" stroke="#8a6c44" stroke-width=".8"/>',
  },
  basket: {
    w: 8, h: 8,
    body: '<rect width="8" height="8" fill="#8a7454"/><rect width="4" height="4" fill="#6a5840"/><rect x="4" y="4" width="4" height="4" fill="#6a5840"/>',
  },
  blackweave: {
    w: 4, h: 4,
    body: '<rect width="4" height="4" fill="#1c1c1e"/><path d="M0 2 H4" stroke="#2e2e32" stroke-width="1"/><path d="M2 0 V4" stroke="#0e0e10" stroke-width="1"/>',
  },
  metalgrid: {
    w: 5, h: 5,
    body: '<rect width="5" height="5" fill="#26282a"/><circle cx="2.5" cy="2.5" r="1.5" fill="#0c0d0e"/>',
  },
};

/** Representative flat colour of each pattern, for anything that needs one hex. */
export const PATTERN_HEX: Record<string, string> = {
  tweed: '#c9a86a', oxblood: '#4a2028', silverface: '#a8a49a', wheat: '#cfc0a0',
  diamond: '#5a4632', cane: '#c8a878', basket: '#8a7454', blackweave: '#1c1c1e',
  metalgrid: '#26282a', bluecheck: '#28407c', orangeweave: '#d86a1a', diamondplate: '#b0b4b8',
};

/** Whether a look colour is a pattern name rather than a plain hex. */
export function isPattern(value: string | undefined): value is string {
  return value !== undefined && !value.startsWith('#') && value in PATTERN_TILES;
}

/**
 * A `<pattern>` element as markup. Unknown names get a flat tile of `base`, the
 * same fallback the generator has always used.
 */
export function patternDef(kind: string, id: string, base: string, scale = 1): string {
  const tile = PATTERN_TILES[kind];
  if (!tile) {
    return `<pattern id="${id}" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="${base}"/></pattern>`;
  }
  const transforms = [scale !== 1 ? `scale(${scale})` : '', tile.rotate ? `rotate(${tile.rotate})` : '']
    .filter(Boolean)
    .join(' ');
  const transform = transforms ? ` patternTransform="${transforms}"` : '';
  return `<pattern id="${id}" width="${tile.w}" height="${tile.h}" patternUnits="userSpaceOnUse"${transform}>\n${tile.body}</pattern>`;
}
