// Tine layout from the instrument schematics (spec 4.2/4.3).
// Geometry data below is GENERATED from src/instruments/*.json - do not edit
// the key tables by hand; re-run the generator or edit the JSON instead.
//
// The default (dzavadzimu) layout is the provisional 24-key schematic:
// rank 1 = bass row (left, longest tines), rank 2/3 = right-hand mid/high
// rows. y staggers each rank's start height, lengthPx drives tine length and
// width. Until the host sends an `instrument` message the UI shows the
// default instrument; mock/dev mode does the same.

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

// -- generated geometry (from src/instruments/*.json) ------------------------
const GEOMETRY = {"mbira-dzavadzimu":{"name":"Mbira dzaVadzimu","cw":800,"ch":300,"keys":[{"note":48,"name":"C3","rank":1,"x":60,"y":158,"len":150},{"note":50,"name":"D3","rank":1,"x":96,"y":152,"len":146},{"note":52,"name":"E3","rank":1,"x":132,"y":147,"len":142},{"note":53,"name":"F3","rank":1,"x":168,"y":143,"len":138},{"note":55,"name":"G3","rank":1,"x":204,"y":141,"len":134},{"note":57,"name":"A3","rank":1,"x":240,"y":143,"len":130},{"note":59,"name":"B3","rank":1,"x":276,"y":147,"len":126},{"note":60,"name":"C4","rank":1,"x":312,"y":152,"len":122},{"note":62,"name":"D4","rank":2,"x":350,"y":118,"len":105.0},{"note":64,"name":"E4","rank":2,"x":388,"y":112,"len":102.5},{"note":65,"name":"F4","rank":2,"x":426,"y":108,"len":100.0},{"note":67,"name":"G4","rank":2,"x":464,"y":105,"len":97.5},{"note":69,"name":"A4","rank":2,"x":502,"y":105,"len":95.0},{"note":71,"name":"B4","rank":2,"x":540,"y":108,"len":92.5},{"note":72,"name":"C5","rank":2,"x":578,"y":112,"len":90.0},{"note":74,"name":"D5","rank":2,"x":616,"y":118,"len":87.5},{"note":76,"name":"E5","rank":3,"x":350,"y":218,"len":88},{"note":77,"name":"F5","rank":3,"x":388,"y":212,"len":86},{"note":79,"name":"G5","rank":3,"x":426,"y":208,"len":84},{"note":81,"name":"A5","rank":3,"x":464,"y":206,"len":82},{"note":83,"name":"B5","rank":3,"x":502,"y":206,"len":80},{"note":84,"name":"C6","rank":3,"x":540,"y":208,"len":78},{"note":86,"name":"D6","rank":3,"x":578,"y":212,"len":76},{"note":88,"name":"E6","rank":3,"x":616,"y":218,"len":74}]},"nyunga-nyunga":{"name":"Nyunga Nyunga","cw":600,"ch":300,"keys":[{"note":60,"name":"C4","rank":1,"x":100,"y":105,"len":120},{"note":62,"name":"D4","rank":1,"x":160,"y":100,"len":115},{"note":64,"name":"E4","rank":1,"x":220,"y":96,"len":110},{"note":65,"name":"F4","rank":1,"x":280,"y":94,"len":105},{"note":67,"name":"G4","rank":1,"x":340,"y":96,"len":100},{"note":69,"name":"A4","rank":1,"x":400,"y":100,"len":95},{"note":71,"name":"B4","rank":1,"x":460,"y":105,"len":90},{"note":72,"name":"C5","rank":2,"x":80,"y":175,"len":100},{"note":74,"name":"D5","rank":2,"x":140,"y":169,"len":96},{"note":76,"name":"E5","rank":2,"x":200,"y":165,"len":92},{"note":77,"name":"F5","rank":2,"x":260,"y":163,"len":88},{"note":79,"name":"G5","rank":2,"x":320,"y":163,"len":84},{"note":81,"name":"A5","rank":2,"x":380,"y":165,"len":80},{"note":83,"name":"B5","rank":2,"x":440,"y":169,"len":76},{"note":84,"name":"C6","rank":2,"x":500,"y":175,"len":72}]}};

// -- board mapping -----------------------------------------------------------
// Percentages of the .board element, modelled on how a mbira actually reads:
// every rank hangs from the bridge, but each rank ENDS at a different depth
// (bass row reaches lowest, front high row stops well above it), so the
// ranks read as interleaved staircases instead of one uniform grid. Within a
// rank, lengthPx drives the relative length; absolute length drives width.
const RANK_BOTTOM = { 1: 92, 2: 80, 3: 68, 4: 58 }; // % where each rank ends

export let currentId = 'mbira-dzavadzimu';

export function setInstrument(id){
  if (!GEOMETRY[id]) return false;
  currentId = id;
  return true;
}

export function instrumentName(){
  return GEOMETRY[currentId].name;
}

/**
 * @returns {{midi:number,rank:number,x:number,w:number,top:number,h:number,
 *            name:string,len:number}[]}
 */
export function buildTines(){
  const inst = GEOMETRY[currentId];
  // Interleave duplicated ranks: if a rank's x positions exactly duplicate
  // another rank's (dzavadzimu ranks 2/3 share x), offset it by half its own
  // spacing so the rows read as interlocked keys, not stacked copies.
  const spacing = {};
  for (const r of new Set(inst.keys.map((k) => k.rank))){
    const sx = inst.keys.filter((k) => k.rank === r).map((k) => k.x).sort((a, b) => a - b);
    if (sx.length > 1){
      const d = [];
      for (let i = 1; i < sx.length; ++i) d.push(sx[i] - sx[i - 1]);
      d.sort((a, b) => a - b);
      spacing[r] = d[Math.floor(d.length / 2)];
    } else spacing[r] = 0;
  }
  const geo = inst.keys.map((k) => {
    const dup = inst.keys.some((o) => o.rank < k.rank && o.x === k.x);
    return { ...k, x: dup ? k.x + spacing[k.rank] / 2 : k.x };
  });
  const xs = geo.map((k) => k.x);
  const xL = Math.min(...xs), xR = Math.max(...xs);
  const rankMax = {}, rankMin = {};
  for (const k of inst.keys){
    rankMax[k.rank] = Math.max(rankMax[k.rank] ?? 0, k.len);
    rankMin[k.rank] = Math.min(rankMin[k.rank] ?? Infinity, k.len);
  }
  return geo.map((k) => {
    // all tines anchor just under the bridge; y only nudges the anchor
    // slightly (rank stagger), it no longer pushes tines away from the bridge
    const top = 6 + (k.y / inst.ch) * 9;
    // gentle fan: shorter tines in a rank end a little higher, so the tips
    // trace a curve instead of one flat baseline
    const rel = (k.len - rankMin[k.rank]) / Math.max(1e-6, rankMax[k.rank] - rankMin[k.rank]);
    const bottom = (RANK_BOTTOM[k.rank] ?? 92) - (1 - rel) * 14;
    const h = bottom - top;
    return {
      midi: k.note,
      rank: k.rank,
      name: k.name || noteName(k.note),
      // remap the schematic's x range across the full board (7%..93%)
      x: 7 + ((k.x - xL) / Math.max(1, xR - xL)) * 86,
      top,
      h,
      w: Math.min(5.8, Math.max(2.8, 1.6 + Math.pow(k.len / 150, 1.5) * 4.2)),
      len: k.len,
    };
  });
}

/** QWERTY map - assigned in visual order (top rank first, left-to-right). */
export function buildKeymap(tines){
  const order = [...tines].sort((a, b) =>
    a.rank - b.rank || a.x - b.x);
  const keys = 'qwertyuiopasdfghjklzxcvbnm';
  const keymap = {};
  order.forEach((t, i) => { if (i < keys.length) keymap[keys[i]] = t.midi; });
  return keymap;
}
