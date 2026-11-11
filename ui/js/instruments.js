// Instrument registry for the runtime selector. Each `id` MUST match an `id`
// field in src/instruments/*.json — the native host resolves id -> path via a
// registry keyed on these exact ids (see src/native/main.cpp resolveInstrumentPath).
export const INSTRUMENTS = [
  { id: 'mbira-dzavadzimu', label: 'dzaVadzimu' },
  { id: 'nyunga-nyunga', label: 'nyunga-nyunga' },
];
