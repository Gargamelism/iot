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
    id: "web-sim",
    title: "Firmware simulator (original 3-osc)",
    description:
      "The early 3-oscillator firmware ported to the browser: smoothed pots, DDS sine oscillators, the 72×40 OLED and per-oscillator scopes.",
  },
];
