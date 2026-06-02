// Pure filtering helpers — no DOM, no state. Reused by the viewer today and by
// quiz/test modes later (they just consume the same filtered set).

// All distinct tags across the cards, sorted (the union shown as toggle buttons).
export function allTags(cards) {
  const set = new Set();
  for (const c of cards) for (const t of c.tags || []) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// deck: 'All' | 'NATO' | 'China' | 'Russia'
// tags: Set of active tags. A card must match the deck AND contain EVERY active
//       tag (intersection — selecting more tags narrows the set).
// practiceOnly + practiceSet: when practiceOnly is true, keep only cards whose id
//       is in practiceSet (the locally-saved selection).
// pov: 'standard' (default) shows only standard-POV cards; 'all' includes the
//       alternate-viewpoint cards too.
export function filterCards(cards, { deck, tags, practiceOnly, practiceSet, pov }) {
  return cards.filter((c) => {
    if ((pov || 'standard') === 'standard' && c.pov === 'alt') return false;
    if (deck && deck !== 'All' && c.deck !== deck) return false;
    if (practiceOnly && !(practiceSet && practiceSet.has(c.id))) return false;
    if (tags && tags.size) {
      const have = new Set(c.tags || []);
      for (const t of tags) if (!have.has(t)) return false;
    }
    return true;
  });
}
