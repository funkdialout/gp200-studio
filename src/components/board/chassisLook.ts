/**
 * The non-visual half of the board chassis: which template a pedal draws, the
 * CSS variables and classes it needs, and which footswitch and knob ink go with
 * it. Split from PedalChassis.tsx so that file exports only components.
 */
import type { CSSProperties } from 'react';
import type { PedalArtEntry, PedalLook } from './pedalManifest';
import { PATTERN_HEX, isPattern } from './patterns';

/** Look for an entry; manifests written before `look` existed draw a stompbox. */
export function resolveLook(art: PedalArtEntry | undefined): PedalLook {
  return art?.look ?? { template: 'stomp', label: '', shape: 'standard', plate: true };
}

/** Templates whose footswitch is a round stomp button rather than a plate. */
export function usesRoundStomp(look: PedalLook, wide: boolean): boolean {
  switch (look.template) {
    case 'amp':
    case 'cab':
    case 'acoustic':
    case 'rack':
    case 'tape':
      return true;
    case 'rocker':
      return false;
    case 'stomp':
      return wide || look.plate === false;
    default:
      return wide;
  }
}

/** darken/lighten a hex by amount (-1..1), the generator's `shade` */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  const rgb = (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255);
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

export const hexOf = (value: string | undefined, fallback: string) =>
  value === undefined ? fallback : value.startsWith('#') ? value : (PATTERN_HEX[value] ?? fallback);

/** CSS custom properties a template reads, on top of the body colours. */
export function lookVars(look: PedalLook): CSSProperties {
  const vars: Record<string, string> = {};
  if (look.tolex) vars['--tolex'] = hexOf(look.tolex, '#1c1c1e');
  if (look.panel) vars['--panel'] = hexOf(look.panel, '#26282c');
  if (look.panelText) vars['--panel-text'] = look.panelText;
  if (look.piping) vars['--piping'] = look.piping;
  if (look.lamp) vars['--lamp'] = look.lamp;
  if (look.wood) vars['--wood'] = look.wood;
  if (look.displayColor) vars['--display'] = look.displayColor;
  if (look.sliderColor) vars['--slider'] = look.sliderColor;
  if (look.template === 'acoustic') {
    // the instrument lies in a dark plush case: the manifest body colour is the
    // wood, which belongs to the guitar drawing, not the enclosure or its ink
    vars['--body'] = '#3a2a26';
    vars['--body-deep'] = '#1e1614';
    vars['--ink'] = '#ece6da';
  }
  return vars as CSSProperties;
}

/** Class names for the article: template, plus the stomp shape. */
export function chassisClasses(look: PedalLook): string[] {
  const classes = [`tpl-${look.template}`];
  if (look.template === 'stomp' && look.shape && look.shape !== 'standard') {
    classes.push(`shape-${look.shape}`);
  }
  if (look.panel && isPattern(look.panel)) classes.push('panel-pattern');
  return classes;
}

/** Class for the controls block, by template. */
export function controlsClass(look: PedalLook, legacyPanel: boolean): string {
  switch (look.template) {
    case 'amp':
      return ' amp-panel';
    case 'cab':
      return ' back-plate';
    case 'acoustic':
      return ' strip-plate';
    default:
      return legacyPanel ? ' amp-panel' : '';
  }
}

/**
 * Tick/label ink for knobs, by the surface they sit on (the panel for amps, the
 * plate for cabs), so every label keeps its contrast.
 */
export function controlsInk(look: PedalLook, bodyInk: string, panelText: string | undefined): string {
  switch (look.template) {
    case 'amp':
      return panelText ?? bodyInk;
    case 'cab':
      return '#1c1c1e';
    case 'acoustic':
      return '#ece6da';
    default:
      return panelText ?? bodyInk;
  }
}
