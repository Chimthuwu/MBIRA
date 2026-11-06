globalThis.__VARIANT='edge';
import {Renderer, el} from '@elemaudio/core';

// Minimal single-voice tine variants for native-host bisection.
// Variant selection via globalThis.__VARIANT (set by a prepended script in the bundle).

const core = new Renderer((batch) => { __postNativeMessage__(JSON.stringify(batch)); });

const v = globalThis.__VARIANT || 'full';
let graph;

if (v === 'osc') {
  // bare oscillator at fixed gain
  graph = el.mul(0.2, el.cycle(261.6));
} else if (v === 'env') {
  // oscillator * env(const 1)  — tests el.env path
  graph = el.mul(0.2, el.env(el.tau2pole(0.0002), el.tau2pole(0.03), el.const({ key: 'd', value: 1 })), el.cycle(261.6));
} else if (v === 'edge') {
  // gate const 1 from start, edge = gate - z(gate), impulse -> decay
  const gate = el.const({ key: 'g', value: 1 });
  const edge = el.sub(gate, el.z(gate));
  graph = el.mul(0.2, el.smooth(el.tau2pole(1.2), edge), el.cycle(261.6));
} else {
  // full: keyed gate const starting 0; the host flips it via re-render
  const gate = el.const({ key: 'g', value: 0 });
  const edge = el.sub(gate, el.z(gate));
  const env = el.mul(1.0 / (1.0 - Math.exp(-1.0 / (1.2 * 48000))), el.smooth(el.tau2pole(1.2), edge));
  const relEnv = el.env(el.tau2pole(0.0002), el.tau2pole(0.03), el.const({ key: 'd', value: 0 }));
  graph = el.mul(0.2, relEnv, env, el.cycle(261.6));
}

core.render(graph, graph);
globalThis.__mbira = {
  noteOn() {}, noteOff() {},
  trigger() { core.render(graph, graph); },
};
