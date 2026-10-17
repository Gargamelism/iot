// Client-side registry: playground id -> component + its default state.
// Add new playgrounds here and in ./meta.ts.
import type { ComponentType } from "react";
import type { PlaygroundProps } from "./types";
import { WebSim, webSimDefault } from "./web-sim/WebSim";
import { HarmonicLab, harmonicLabDefault } from "./harmonic-lab/HarmonicLab";

export const PLAYGROUND_COMPONENTS: Record<
  string,
  { Component: ComponentType<PlaygroundProps<never>>; defaultState: unknown }
> = {
  "harmonic-lab": { Component: HarmonicLab as unknown as ComponentType<PlaygroundProps<never>>, defaultState: harmonicLabDefault },
  "web-sim": { Component: WebSim as unknown as ComponentType<PlaygroundProps<never>>, defaultState: webSimDefault },
};
