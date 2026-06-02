// Data model + persistence. Holds the authoritative in-memory card list and
// every mutation that commits back to the repo. The UI layer (app.js) and any
// future mode (quiz, test) talk to the data ONLY through this module.
//
// Design notes:
//  - Reads load cards.json over plain HTTPS from the Pages site (no token).
//  - Writes serialize the FULL local array (deterministically, byte-identical
//    to scripts/build-manifest.js output) and PUT it with the latest sha.
//  - The local array is treated as authoritative on save; the build Action is
//    self-healing — it re-derives missingImage and re-adds any image that is
//    actually on disk, so a momentary overwrite can't lose real data.

import {
  MANIFEST_PATH,
  FOLDER_BY_DECK,
  cardId,
} from './config.js';
import {
  getContent,
  putFile,
  deleteFile,
  utf8ToBase64,
  bytesToBase64,
} from './github.js';

let cards = []; // the live model

// --- accessors --------------------------------------------------------------

export function getCards() {
  return cards;
}

export function findById(id) {
  return cards.find((c) => c.id === id) || null;
}

// --- loading ----------------------------------------------------------------

// Load the manifest from the served site (cache-busted). Returns the array.
export async function loadCards() {
  const res = await fetch(`${MANIFEST_PATH}?cb=${cacheBust()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${MANIFEST_PATH}: ${res.status}`);
  const data = await res.json();
  cards = Array.isArray(data) ? data : Array.isArray(data?.cards) ? data.cards : [];
  return cards;
}

// A deterministic-but-changing token for cache busting without Date.now reliance
// concerns (this runs in the browser, where Date is fine).
function cacheBust() {
  return Date.now().toString(36);
}

// --- serialization (must match the build script byte-for-byte) --------------

function serialize(list) {
  const sorted = [...list].sort(
    (a, b) =>
      String(a.deck).localeCompare(String(b.deck)) ||
      String(a.name).localeCompare(String(b.name)) ||
      String(a.id).localeCompare(String(b.id))
  );
  return JSON.stringify(sorted, null, 2) + '\n';
}

// PUT the whole manifest. Fetches the latest sha first; retries once on 409.
async function saveManifest(token, message) {
  const text = serialize(cards);
  const contentBase64 = utf8ToBase64(text);

  const doPut = async () => {
    const existing = await getContent(MANIFEST_PATH, token); // latest sha
    return putFile({
      path: MANIFEST_PATH,
      contentBase64,
      message,
      sha: existing?.sha,
      token,
    });
  };

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await doPut();
    } catch (err) {
      lastErr = err;
      if (!String(err).includes('409')) throw err; // only retry sha conflicts
    }
  }
  throw lastErr;
}

// --- helpers ----------------------------------------------------------------

function sanitizeFilename(name) {
  // Keep it human-readable; just strip path separators and trim.
  return String(name).replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function imagePathFor(deck, name) {
  const folder = FOLDER_BY_DECK[deck];
  return `${folder}/${sanitizeFilename(name)}.png`;
}

function uniqueId(baseId) {
  if (!findById(baseId)) return baseId;
  let n = 2;
  while (findById(`${baseId}-${n}`)) n += 1;
  return `${baseId}-${n}`;
}

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

// --- mutations (each commits back) ------------------------------------------

// Add a tag to a card (no-op if already present).
export async function addTag(id, tag, token) {
  const card = findById(id);
  if (!card) throw new Error('card not found');
  const clean = String(tag).trim();
  if (!clean) return card;
  card.tags = card.tags || [];
  if (!card.tags.includes(clean)) card.tags.push(clean);
  await saveManifest(token, `cards: add tag "${clean}" to ${card.name}`);
  return card;
}

// Remove a tag from a card.
export async function removeTag(id, tag, token) {
  const card = findById(id);
  if (!card) throw new Error('card not found');
  card.tags = (card.tags || []).filter((t) => t !== tag);
  await saveManifest(token, `cards: remove tag "${tag}" from ${card.name}`);
  return card;
}

// Rename a card's answer.
export async function renameCard(id, newName, token) {
  const card = findById(id);
  if (!card) throw new Error('card not found');
  const clean = String(newName).trim();
  if (!clean) throw new Error('name cannot be empty');
  card.name = clean;
  await saveManifest(token, `cards: rename to "${clean}"`);
  return card;
}

// Replace a card's image IN PLACE (same path) so the manifest path is stable
// and no orphan file is left for the Action to resurrect.
export async function replaceImage(id, file, token) {
  const card = findById(id);
  if (!card) throw new Error('card not found');
  const path = card.image;
  const contentBase64 = await fileToBase64(file);
  const existing = await getContent(path, token); // may be null if file missing
  await putFile({
    path,
    contentBase64,
    message: `images: replace ${path}`,
    sha: existing?.sha,
    token,
  });
  if (card.missingImage) {
    delete card.missingImage;
    await saveManifest(token, `cards: image restored for ${card.name}`);
  }
  return card;
}

// Duplicate a card: new independent id/name/tags, SAME image (no upload).
export async function duplicateCard(id, token) {
  const src = findById(id);
  if (!src) throw new Error('card not found');
  const name = `${src.name} copy`;
  const dup = {
    id: uniqueId(cardId(src.deck, name)),
    deck: src.deck,
    name,
    image: src.image, // shared; build script won't flag it (image is on disk)
    tags: [...(src.tags || [])],
  };
  cards.push(dup);
  await saveManifest(token, `cards: duplicate ${src.name}`);
  return dup;
}

// Create a new card from scratch: upload the image, then add the card.
export async function createCard({ deck, name, file, tags }, token) {
  const clean = sanitizeFilename(name);
  if (!clean) throw new Error('name cannot be empty');
  const path = imagePathFor(deck, clean);
  const id = uniqueId(cardId(deck, clean));

  const contentBase64 = await fileToBase64(file);
  const existing = await getContent(path, token); // overwrite if same path exists
  await putFile({
    path,
    contentBase64,
    message: `images: add ${path}`,
    sha: existing?.sha,
    token,
  });

  const card = { id, deck, name: clean, image: path, tags: tags || [] };
  cards.push(card);
  await saveManifest(token, `cards: create ${deck}/${clean}`);
  return card;
}

// Delete a card. Also deletes its image file UNLESS another card still
// references it (a duplicate) or the image is already missing — otherwise the
// build Action would just re-add the card from the orphaned image on disk.
export async function deleteCard(id, token) {
  const card = findById(id);
  if (!card) throw new Error('card not found');

  const sharedByOther = cards.some((c) => c.id !== id && c.image === card.image);
  cards = cards.filter((c) => c.id !== id);

  if (!card.missingImage && !sharedByOther) {
    const existing = await getContent(card.image, token);
    if (existing?.sha) {
      await deleteFile({
        path: card.image,
        sha: existing.sha,
        message: `images: delete ${card.image}`,
        token,
      });
    }
  }
  await saveManifest(token, `cards: delete ${card.name}`);
  return card;
}
