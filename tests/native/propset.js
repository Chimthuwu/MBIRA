import {Renderer, el} from '@elemaudio/core';

// Bisection: does a SET_PROPERTY via re-render change native audio at all?
// Initial: amp const = 0 (silent). trigger(): re-render with amp = 1.
const core = new Renderer((batch) => { __postNativeMessage__(JSON.stringify(batch)); });

let ampVal = 0;
function graph() {
  return el.mul(el.const({ key: 'amp', value: ampVal }), el.cycle(261.6));
}
core.render(graph(), graph());

globalThis.__mbira = {
  trigger() { ampVal = 1; core.render(graph(), graph()); },
  noteOn() {}, noteOff() {},
};
