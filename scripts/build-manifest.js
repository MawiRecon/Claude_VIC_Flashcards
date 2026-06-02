#!/usr/bin/env node
/*
 * build-manifest.js
 * ------------------
 * Regenerates cards.json by scanning the image folders and MERGING with the
 * existing manifest. The repo is the source of truth; this script never wipes
 * user edits (names, tags, etc.) — it only reconciles the image inventory.
 *
 * Rules (kept identical in spirit to the in-app logic in github.js/store.js):
 *   - deck  = folder name mapped via DECK_BY_FOLDER (images_NATO -> NATO, ...)
 *   - name  = filename without extension (the card answer)
 *   - image = repo-relative path, forward slashes (e.g. images_NATO/Abrams.png)
 *   - id    = slug(deck) + '-' + slug(name)  (lowercased, punctuation stripped)
 *
 * Merge behaviour:
 *   - New image  (its canonical id is not in cards.json) -> add card, tags: []
 *   - Existing card -> preserved EXACTLY (name, tags, every edited field);
 *                      only its `image` path is refreshed if the file moved.
 *   - missingImage  is a derived flag: true when the card's `image` file is
 *                   NOT present on disk. This is image-path based (not id based)
 *                   so duplicate cards that share an existing image are never
 *                   wrongly flagged, and a card whose file reappears is healed.
 *   - Cards are NEVER deleted here; absence is recorded with missingImage.
 *
 * No dependencies — plain Node (fs/path). Output is deterministic (sorted,
 * 2-space pretty-printed, trailing newline) so commits stay clean.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Repo root is the parent of this script's folder.
const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'cards.json');

// Folder -> deck label. The only place the mapping lives on the build side.
const DECK_BY_FOLDER = {
  images_NATO: 'NATO',
  images_china: 'China',
  images_russia: 'Russia',
};

const IMAGE_EXT = /\.png$/i;

/** Lowercase + strip everything that isn't a-z0-9. */
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Stable card id from deck + name. */
function cardId(deck, name) {
  return `${slug(deck)}-${slug(name)}`;
}

/** Scan the known folders, return [{ deck, name, image, id }]. */
function scanDisk() {
  const found = [];
  for (const folder of Object.keys(DECK_BY_FOLDER)) {
    const dir = path.join(ROOT, folder);
    if (!fs.existsSync(dir)) continue;
    const deck = DECK_BY_FOLDER[folder];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !IMAGE_EXT.test(entry.name)) continue;
      const name = entry.name.replace(IMAGE_EXT, '');
      const image = `${folder}/${entry.name}`; // forward slashes for the web
      found.push({ deck, name, image, id: cardId(deck, name) });
    }
  }
  return found;
}

/** Load existing manifest (tolerant of missing/empty/legacy-object shapes). */
function loadManifest() {
  if (!fs.existsSync(MANIFEST)) return [];
  const raw = fs.readFileSync(MANIFEST, 'utf8').trim();
  if (!raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`cards.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.cards)) return data.cards; // {cards:[...]} shape
  return [];
}

function main() {
  const disk = scanDisk();
  const diskPaths = new Set(disk.map((d) => d.image));
  const diskById = new Map(disk.map((d) => [d.id, d]));

  const existing = loadManifest();
  const byId = new Map();
  for (const card of existing) {
    if (card && card.id) byId.set(card.id, { ...card });
  }

  let newCount = 0;
  const newNames = [];

  // 1) Reconcile each disk image into the manifest.
  for (const d of disk) {
    const prior = byId.get(d.id);
    if (!prior) {
      byId.set(d.id, { id: d.id, deck: d.deck, name: d.name, image: d.image, tags: [] });
      newCount += 1;
      newNames.push(`${d.deck}/${d.name}`);
    } else {
      // Preserve everything; only refresh the image path if the file moved.
      if (prior.image !== d.image) prior.image = d.image;
      if (!prior.deck) prior.deck = d.deck;
      if (prior.name == null) prior.name = d.name;
    }
  }

  // 2) Derive missingImage for every card from actual file presence.
  let missingCount = 0;
  const missingNames = [];
  for (const card of byId.values()) {
    const present = card.image && diskPaths.has(card.image);
    if (present) {
      if ('missingImage' in card) delete card.missingImage;
    } else {
      card.missingImage = true;
      missingCount += 1;
      missingNames.push(`${card.deck || '?'}/${card.name || card.id}`);
    }
  }

  // 3) Deterministic order: deck, then name, then id.
  const cards = [...byId.values()].sort((a, b) => {
    return (
      String(a.deck).localeCompare(String(b.deck)) ||
      String(a.name).localeCompare(String(b.name)) ||
      String(a.id).localeCompare(String(b.id))
    );
  });

  const output = JSON.stringify(cards, null, 2) + '\n';
  const prevRaw = fs.existsSync(MANIFEST) ? fs.readFileSync(MANIFEST, 'utf8') : '';
  const changed = prevRaw !== output;
  if (changed) fs.writeFileSync(MANIFEST, output);

  // Per-deck totals.
  const perDeck = {};
  for (const c of cards) perDeck[c.deck] = (perDeck[c.deck] || 0) + 1;

  // Summary.
  console.log('--- build-manifest summary ---');
  console.log(`total cards:   ${cards.length}`);
  console.log(`new cards:     ${newCount}${newNames.length ? '  (' + newNames.join(', ') + ')' : ''}`);
  console.log('per-deck totals:');
  for (const deck of Object.keys(perDeck).sort()) {
    console.log(`  ${deck}: ${perDeck[deck]}`);
  }
  console.log(`missing images: ${missingCount}${missingNames.length ? '  (' + missingNames.join(', ') + ')' : ''}`);
  console.log(`cards.json ${changed ? 'UPDATED' : 'unchanged'}`);

  // Expose "changed" to the workflow via stdout marker + exit code stays 0.
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed ? 'true' : 'false'}\n`);
  }
}

main();
