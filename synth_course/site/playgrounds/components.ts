// Client-side registry: playground id -> component + its default state.
// Add new playgrounds here and in ./meta.ts.
import type { ComponentType } from "react";
import type { PlaygroundProps } from "./types";
import { WebSim, webSimDefault } from "./web-sim/WebSim";

export const PLAYGROUND_COMPONENTS: Record<
  string,
  { Component: ComponentType<PlaygroundProps<never>>; defaultState: unknown }
> = {
  "web-sim": { Component: WebSim as unknown as ComponentType<PlaygroundProps<never>>, defaultState: webSimDefault },
};
