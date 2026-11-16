// Server-safe list of playgrounds (no React, no browser APIs): titles and which
// module each belongs to. The components themselves are in ./components.ts.
export interface PlaygroundMeta {
  id: string;
  title: string;
  module?: string; // course module id it accompanies, if any
  description: string;
}

export const PLAYGROUNDS: PlaygroundMeta[] = [
  {
    id: "harmonic-lab",
    title: "Harmonic lab",
    module: "07-band-limited-wavetables",
    description:
      "Draw a spectrum with 32 harmonic sliders and hear it through an integer wavetable oscillator. Switch band-limiting off, per octave (mip-map) or exact per note, and sweep the pitch to hear aliasing and the mip boundaries.",
  },
  {
    id: "web-sim",
    title: "Firmware simulator (original 3-osc)",
    description:
      "The early 3-oscillator firmware ported to the browser: smoothed pots, DDS sine oscillators, the 72×40 OLED and per-oscillator scopes.",
  },
];
