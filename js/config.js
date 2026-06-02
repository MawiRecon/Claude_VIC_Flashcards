// Static configuration + shared pure helpers.
// Kept tiny and dependency-free so every other module can import it.

export const REPO = {
  owner: 'MawiRecon',
  repo: 'MSLC-VID-Flashcards',
  branch: 'main',
};

// Folder <-> deck mapping. Mirror of DECK_BY_FOLDER in scripts/build-manifest.js.
export const DECK_BY_FOLDER = {
  images_NATO: 'NATO',
  images_china: 'China',
  images_russia: 'Russia',
};
export const FOLDER_BY_DECK = {
  NATO: 'images_NATO',
  China: 'images_china',
  Russia: 'images_russia',
};
export const DECKS = ['NATO', 'China', 'Russia'];

// localStorage key for the cached PAT (the ONLY thing we persist locally).
export const TOKEN_KEY = 'vic_flashcards_pat';

// localStorage key for the per-browser "practice set" (selected card ids). This
// is purely client-side, so read-only users (friends) can build their own set.
export const PRACTICE_KEY = 'vic_flashcards_practice';

// Path to the committed manifest, relative to the served site root.
export const MANIFEST_PATH = 'cards.json';

// slug + id: identical rules to the build script so ids stay stable on both sides.
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
export const cardId = (deck, name) => `${slug(deck)}-${slug(name)}`;
