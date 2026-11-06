import {Renderer, el} from '@elemaudio/core';
let core = new Renderer((batch) => { __postNativeMessage__(JSON.stringify(batch)); });
let stats = core.render(el.mul(0.3, el.cycle(440)), el.mul(0.3, el.cycle(441)));
console.log(stats);
