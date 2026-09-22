import { useRef } from 'react';
import type { UseMidiDeviceReturn } from '@/hooks/useMidiDevice';
import { LandingHero } from './landing/LandingHero';
import { LandingStats } from './landing/LandingStats';
import { useLandingMotion } from './landing/useLandingMotion';
import './landing/landing.css';

interface LandingProps {
  midiDevice: UseMidiDeviceReturn;
  /** open the editor with a blank INIT preset */
  onOpenBlank: () => void;
  /** open the editor with the connected device's current preset */
  onOpenCurrent: () => void;
  loadError: string | null;
  onDismissError: () => void;
}

/**
 * The home page.
 *
 * The app's front door: the connect button and the blank-preset escape hatch
 * sit under the headline, followed by the compact product stats strip.
 *
 * The page is dark end to end — `.theme-dark`, the inherited-token island
 * declared alongside `:root[data-theme='dark']` in src/index.css — regardless
 * of the theme the editor is set to. A pedalboard photographs better under
 * house lights down, it matches the social card the page is usually reached
 * from, and it means the landing page never has a light/dark state of its own
 * to get out of step with the board's.
 *
 * It is prerendered to static HTML by scripts/prerender.mjs, so everything
 * below is written to read completely with JavaScript switched off: real
 * anchors out to /guide and the write-ups, <details> for the FAQ, the real
 * figures in the stats, and no section that starts life invisible. Motion is
 * layered on top by useLandingMotion, never underneath.
 *
 * Composition only; each section owns its own markup in ./landing/, and every
 * word lives in ./landing/copy.ts.
 */
export function Landing({
  midiDevice,
  onOpenBlank,
  onOpenCurrent,
  loadError,
  onDismissError,
}: LandingProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLandingMotion(rootRef);

  return (
    <div className="lp theme-dark" ref={rootRef}>
      <LandingHero
        midiDevice={midiDevice}
        onOpenBlank={onOpenBlank}
        onOpenCurrent={onOpenCurrent}
        loadError={loadError}
        onDismissError={onDismissError}
      />

      <main className="lp-main">
        <LandingStats />
      </main>
    </div>
  );
}
