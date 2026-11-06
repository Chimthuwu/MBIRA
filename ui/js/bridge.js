/**
 * UI → native bridge.
 * Envelope: { v, type, id, payload }
 * Outbound types are allowlisted here — this is the ONLY place the UI can
 * talk to the host. No graph code, ever.
 */
export const PROTOCOL_VERSION = 1;

const OUTBOUND = new Set([
  'ui.ready',
  'param.set',
  'note.on',
  'note.off',
  'panic',
  'preset.load',
  'preset.save',
  'instrument.select',
]);

const inbound = new Map();
let seq = 0;

const host = () => (typeof window !== 'undefined' && window.chrome?.webview) || null;

export function send(type, payload = {}){
  if (!OUTBOUND.has(type)) throw new Error(`bridge: blocked outbound type "${type}"`);
  const msg = { v: PROTOCOL_VERSION, type, id: ++seq, payload };
  const h = host();
  if (h) h.postMessage(msg);
  else if (window.__MBIRA_MOCK__) window.__MBIRA_MOCK__.receive(msg);
  else console.debug('[ui→host]', msg);
  return msg.id;
}

export function on(type, fn){
  if (!inbound.has(type)) inbound.set(type, new Set());
  inbound.get(type).add(fn);
  return () => inbound.get(type).delete(fn);
}

function dispatch(msg){
  if (!msg || msg.v !== PROTOCOL_VERSION) return;
  const set = inbound.get(msg.type);
  if (!set) return;
  for (const fn of set) { try { fn(msg.payload, msg); } catch (e) { console.error(e); } }
}

// Host → UI
if (host()){
  host().addEventListener('message', (e) =>
    dispatch(typeof e.data === 'string' ? JSON.parse(e.data) : e.data));
}

// Exposed so the dev mock (main.js) can push fake telemetry
window.__MBIRA_DISPATCH__ = dispatch;
