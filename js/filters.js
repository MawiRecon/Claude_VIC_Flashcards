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

// Distinct categories present, alphabetical. If `classes` (a Set) is non-empty,
// only categories belonging to those classes are returned (drill-down).
export function allCategories(cards, classes) {
  const limit = classes && classes.size ? classes : null;
  const set = new Set();
  for (const c of cards) {
    if (!c.category) continue;
    if (limit && !limit.has(c.class)) continue;
    set.add(c.category);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// A multi-select dimension matches when its Set is empty (= All) OR contains the
// card's value. Dimensions AND together; values within a dimension OR together.
function inSet(set, value) {
  return !set || set.size === 0 || set.has(value);
}

// POV matching. `pov` is one of:
//   'standard' (default) -> only standard-POV cards
//   'all'                -> every card (standard + all alt views)
//   Set<viewType>        -> only alt cards whose `viewType` is in the set
//                           (e.g. {'Side/Profile','Top'} — a subset of alt views)
export function povMatch(card, pov) {
  if (pov instanceof Set) return card.pov === 'alt' && pov.has(card.viewType);
  if (pov === 'all') return true;
  return card.pov !== 'alt'; // 'standard' / default
}

// decks / classes / categories: Sets (empty = no constraint).
// practiceOnly + practiceSet: when practiceOnly, keep only ids in practiceSet.
// pov: see povMatch above.
export function filterCards(cards, { decks, classes, categories, practiceOnly, practiceSet, pov }) {
  return cards.filter((c) => {
    if (!povMatch(c, pov)) return false;
    if (!inSet(decks, c.deck)) return false;
    if (!inSet(classes, c.class)) return false;
    if (!inSet(categories, c.category)) return false;
    if (practiceOnly && !(practiceSet && practiceSet.has(c.id))) return false;
    return true;
  });
}
