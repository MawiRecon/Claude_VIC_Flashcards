// Pure filtering helpers — no DOM, no state. Reused by the viewer and the
// Practice Test (they consume the same filtered set).

// Preferred display order for the broad Class filter; unknown classes appended.
const CLASS_ORDER = ['Armor', 'Artillery', 'Air Defense', 'Aviation', 'Support'];

// Distinct classes present, in preferred order.
export function allClasses(cards) {
  const set = new Set();
  for (const c of cards) if (c.class) set.add(c.class);
  const present = [...set];
  return [
    ...CLASS_ORDER.filter((k) => set.has(k)),
    ...present.filter((k) => !CLASS_ORDER.includes(k)).sort((a, b) => a.localeCompare(b)),
  ];
}

// Distinct categories present, alphabetical. If `klass` is given (not 'All'),
// only categories belonging to that class are returned (drill-down).
export function allCategories(cards, klass) {
  const set = new Set();
  for (const c of cards) {
    if (!c.category) continue;
    if (klass && klass !== 'All' && c.class !== klass) continue;
    set.add(c.category);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// deck: 'All' | 'NATO' | 'China' | 'Russia'
// klass / category: 'All' or a specific value (single-select, AND together).
// practiceOnly + practiceSet: when practiceOnly, keep only ids in practiceSet.
// pov: 'standard' (default) shows only standard cards; 'all' includes alt views.
export function filterCards(cards, { deck, klass, category, practiceOnly, practiceSet, pov }) {
  return cards.filter((c) => {
    if ((pov || 'standard') === 'standard' && c.pov === 'alt') return false;
    if (deck && deck !== 'All' && c.deck !== deck) return false;
    if (klass && klass !== 'All' && c.class !== klass) return false;
    if (category && category !== 'All' && c.category !== category) return false;
    if (practiceOnly && !(practiceSet && practiceSet.has(c.id))) return false;
    return true;
  });
}
