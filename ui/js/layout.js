// Provisional tine layout. Ratios are PLACEHOLDERS (spec amendment 4.9);
// real mbira dzaVadzimu tunings are pending user input.

// C major, C3..B5 — 21 notes
export const SCALE = [
  48,50,52,53,55,57,59, 60,62,64,65,67,69,71, 72,74,76,77,79,81,83
];

const ROWS = 3;
const COLS = 7;

// Pitch order per row. Middle row holds the lowest set, assigned centre-out.
const CENTRE_OUT = [3,4,2,5,1,6,0];

/**
 * @returns {{midi:number,row:number,col:number,x:number,w:number,h:number,top:number}[]}
 * x/w/h/top are percentages of the board.
 */
export function buildTines(){
  const tines = [];
  let p = 0;

  // row 1 (middle) — lowest notes, centre-out, longest tines
  for (const col of CENTRE_OUT){
    tines.push(mk(SCALE[p++], 1, col));
  }
  // row 2 (front/bottom) — next set, left→right
  for (let col = 0; col < COLS; col++){
    tines.push(mk(SCALE[p++], 2, col));
  }
  // row 0 (back/top) — highest set, left→right
  for (let col = 0; col < COLS; col++){
    tines.push(mk(SCALE[p++], 0, col));
  }
  return tines;
}

const ROW_GEO = [
  { top:  8, h: 46, pad: 0.045 },  // back row: shortest, inset
  { top: 10, h: 78, pad: 0.000 },  // middle row: longest
  { top: 12, h: 62, pad: 0.045 },  // front row: medium
];

const WIDTH = 4.4; // % of board per tine

function mk(midi, row, col){
  const g = ROW_GEO[row];
  const usable = 1 - g.pad * 2;
  const step = usable / COLS;
  const x = (g.pad + step * (col + 0.5)) * 100;
  return {
    midi, row, col,
    x,
    w: WIDTH,
    top: g.top,
    h: g.h,
  };
}

/** QWERTY map — by visual position, not pitch. */
export const KEYMAP = {
  // back row
  q:0, w:1, e:2, r:3, t:4, y:5, u:6,
  // middle row
  a:7, s:8, d:9, f:10, g:11, h:12, j:13,
  // front row
  z:14, x:15, c:16, v:17, b:18, n:19, m:20,
};

export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
