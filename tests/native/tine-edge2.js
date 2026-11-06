import {Renderer, el} from '@elemaudio/core';

// Variant A: full tine (z-edge + smooth decay + el.env release), gate 0 -> 1 via trigger.
const core = new Renderer((batch) => { __postNativeMessage__(JSON.stringify(batch)); });

let gateVal = 0;
const SR = 48000;

function graph() {
  const gate = el.const({ key: 'g', value: gateVal });
  const edge = el.sub(gate, el.z(gate));
  const env = el.mul(1.0 / (1.0 - Math.exp(-1.0 / (1.2 * SR))), el.smooth(el.tau2pole(1.2), edge));
  const relEnv = el.env(el.tau2pole(0.0002), el.tau2pole(0.03), el.const({ key: 'd', value: gateVal }));
  return el.mul(0.2, relEnv, env, el.cycle(261.6));
}
core.render(graph(), graph());

globalThis.__mbira = {
  trigger() { gateVal = 1; core.render(graph(), graph()); },
  noteOn() {}, noteOff() {},
};
