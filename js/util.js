// Small shared helpers with no DOM or state.

// Fisher-Yates shuffle, returns a NEW array (does not mutate input).
export function shuffle(input) {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Lenient answer normalizer for the test: case-, space-, and dash-insensitive
// (in fact strips every non-alphanumeric), so "T-72 B3" === "t72b3".
export function normalizeAnswer(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}
