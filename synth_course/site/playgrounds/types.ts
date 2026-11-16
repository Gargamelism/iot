// A playground is a client component controlled by the host: the host owns
// its state (a plain JSON object) so presets can save and restore it.
export interface PlaygroundProps<S> {
  state: S;
  setState: (next: S) => void;
}
