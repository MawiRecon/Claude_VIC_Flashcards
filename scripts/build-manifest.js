#!/usr/bin/env node
/*
 * build-manifest.js
 * ------------------
 * Regenerates cards.json by scanning the image folders and MERGING with the
 * existing manifest. The repo is the source of truth; this script never wipes
 * user edits (names, tags, etc.) — it only reconciles the image inventory.
 *
 * Two kinds of cards:
 *   - STANDARD POV cards: one per image in images_<deck>/ (the original deck).
 *       pov: "standard", name = filename without extension.
 *   - ALTERNATE POV cards: one per image in
 *       "Reference Cards/<Country>/Extracted Images/<Country>_<Vehicle>_ViewN.ext"
 *       pov: "alt", name = the matching STANDARD card's name (so every view of a
 *       vehicle answers the same thing). Where the reference vehicle is named
 *       differently from the standard card, ALT_VEHICLE_TO_CARD maps it and the
 *       reference designation is recorded as `altName` (also added to the
 *       standard card) so the test accepts either name.
 *
 *   id (standard) = slug(deck) + '-' + slug(name)
 *   id (alt)      = slug(deck) + '-' + slug(name) + '-view' + N
 *
 * Merge behaviour (unchanged): new image -> add card (tags: []); existing card
 * preserved exactly (only image path refreshed); missing file -> missingImage
 * flag (image-path based); cards are never deleted here. Deterministic output.
 *
 * No dependencies — plain Node (fs/path).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'cards.json');

// Standard image folder -> deck label.
const DECK_BY_FOLDER = {
  images_NATO: 'NATO',
  images_china: 'China',
  images_russia: 'Russia',
};

// Alternate-POV source: "Reference Cards/<Country>/Extracted Images".
const REF_ROOT = 'Reference Cards';
const REF_SUBDIR = 'Extracted Images';
const REF_DECKS = { Russia: 'Russia', China: 'China', NATO: 'NATO' };

// Canonical vehicle data (Country,Designation,Name,Category,Class; "-" = no
// second name). The single source of truth for second names + Category/Class.
const NAMES_CSV = path.join(ROOT, REF_ROOT, 'vehicle_names.csv');

// Build deck -> Map(normalized-name -> { secondary, category, class }), so a card
// can look up its alternate name + category/class by its own name.
function loadVehicleInfo() {
  const map = {};
  if (!fs.existsSync(NAMES_CSV)) return map;
  const lines = fs.readFileSync(NAMES_CSV, 'utf8').trim().split(/\r?\n/).slice(1);
  for (const line of lines) {
    const [country, designation, name, category, klass] = line.split(',').map((s) => (s || '').trim());
    if (!country || !designation) continue;
    const names = [designation];
    if (name && name !== '-') names.push(name);
    const info = {
      category: category && category !== '-' ? category : null,
      class: klass && klass !== '-' ? klass : null,
    };
    const m = (map[country] = map[country] || new Map());
    for (const a of names) {
      const other = names.find((b) => slug(b) !== slug(a)) || null;
      m.set(slug(a), { ...info, secondary: other });
    }
  }
  return map;
}

// Reference vehicles whose name differs from the standard card. Keyed by deck,
// then slug(vehicle-token-from-filename) -> exact standard card name. The
// reference token itself becomes the card's altName.
const ALT_VEHICLE_TO_CARD = {
  Russia: {
    giatsnit: '2S5',
    hokumb: 'KA 52',
    koalitsiya: '2S35',
    mstas: '2S19',
    shilka: 'ZSU 234',
    solntsepek: 'TOS 1A',
    tunguskam: '2S6',
    uragan: 'BM 27',
  },
  China: {
    z10: 'WZ 10',
    z19: 'WZ 19',
    vt4: 'MBT 3000',
    type86: 'WZ 501',
    type90ii: 'MBT 2000',
    type05: 'PLZ 05',
  },
  NATO: {},
};

const IMAGE_EXT = /\.(png|jpe?g)$/i;

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function cardId(deck, name) {
  return `${slug(deck)}-${slug(name)}`;
}

// --- scanning ---------------------------------------------------------------

/** Standard cards from images_<deck>/. */
function scanStandard() {
  const found = [];
  for (const folder of Object.keys(DECK_BY_FOLDER)) {
    const dir = path.join(ROOT, folder);
    if (!fs.existsSync(dir)) continue;
    const deck = DECK_BY_FOLDER[folder];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !IMAGE_EXT.test(entry.name)) continue;
      const name = entry.name.replace(IMAGE_EXT, '');
      found.push({
        pov: 'standard',
        deck,
        name,
        image: `${folder}/${entry.name}`,
        id: cardId(deck, name),
      });
    }
  }
  return found;
}

const REF_FILE = /^(.+?)_(.+)_View(\d+)$/i; // <Country>_<Vehicle>_ViewN

/**
 * Alternate-POV cards from the Reference Cards tree. Needs the standard names
 * (per deck) to resolve each reference vehicle to the right answer.
 * Returns { items, altNameForStandard, unresolved }.
 */
function scanAlt(standardNamesByDeck) {
  const items = [];
  const unresolved = [];
  // deck -> (standardName -> altName) to backfill onto standard cards.
  const altNameForStandard = {};

  for (const country of Object.keys(REF_DECKS)) {
    const deck = REF_DECKS[country];
    const dir = path.join(ROOT, REF_ROOT, country, REF_SUBDIR);
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !IMAGE_EXT.test(entry.name)) continue;
      if (/_OLD\.[a-z]+$/i.test(entry.name)) continue; // retired sliced halves, no longer used
      const ext = path.extname(entry.name);
      const base = entry.name.slice(0, -ext.length);
      const m = base.match(REF_FILE);
      if (!m) { unresolved.push(`${country}/${entry.name} (unparsed)`); continue; }

      const vehicleToken = m[2];
      const view = parseInt(m[3], 10);
      const vslug = slug(vehicleToken);

      // Resolve the answer name + optional alt name.
      const override = ALT_VEHICLE_TO_CARD[deck] && ALT_VEHICLE_TO_CARD[deck][vslug];
      let name;
      let altName;
      if (override) {
        name = override;            // e.g. "2S5"
        altName = vehicleToken;     // e.g. "Giatsnit" (faithful to the source)
        (altNameForStandard[deck] = altNameForStandard[deck] || {})[name] = altName;
      } else if (standardNamesByDeck[deck] && standardNamesByDeck[deck].has(vslug)) {
        name = standardNamesByDeck[deck].get(vslug); // same vehicle, exact card name
      } else {
        name = vehicleToken.replace(/[_-]+/g, ' ').trim(); // fallback (no match)
        unresolved.push(`${country}/${vehicleToken} (no standard card)`);
      }

      const image = `${REF_ROOT}/${country}/${REF_SUBDIR}/${entry.name}`;
      const id = `${cardId(deck, name)}-view${view}`;
      const card = { pov: 'alt', deck, name, image, view, id };
      if (altName) card.altName = altName;
      items.push(card);
    }
  }
  return { items, altNameForStandard, unresolved };
}

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
  if (data && Array.isArray(data.cards)) return data.cards;
  return [];
}

function main() {
  const standard = scanStandard();
  const standardNamesByDeck = {};
  for (const s of standard) {
    (standardNamesByDeck[s.deck] = standardNamesByDeck[s.deck] || new Map()).set(slug(s.name), s.name);
  }

  const { items: alt, altNameForStandard, unresolved } = scanAlt(standardNamesByDeck);

  const disk = [...standard, ...alt];
  const diskPaths = new Set(disk.map((d) => d.image));

  const existing = loadManifest();
  const byId = new Map();
  for (const card of existing) {
    if (card && card.id) byId.set(card.id, { ...card });
  }

  let newStd = 0, newAlt = 0;
  const newNames = [];

  // 1) Reconcile each disk image into the manifest.
  for (const d of disk) {
    const prior = byId.get(d.id);
    if (!prior) {
      const card = { id: d.id, deck: d.deck, name: d.name, image: d.image, pov: d.pov };
      if (d.pov === 'alt') card.view = d.view;
      if (d.altName) card.altName = d.altName;
      byId.set(d.id, card);
      if (d.pov === 'alt') newAlt += 1; else { newStd += 1; newNames.push(`${d.deck}/${d.name}`); }
    } else {
      // Preserve everything; only refresh derived/structural bits.
      if (prior.image !== d.image) prior.image = d.image;
      if (!prior.deck) prior.deck = d.deck;
      if (prior.name == null) prior.name = d.name;
      if (!prior.pov) prior.pov = d.pov;                     // backfill pov on legacy cards
      if (d.pov === 'alt' && prior.view == null) prior.view = d.view;
    }
  }

  // 2) Apply canonical data from vehicle_names.csv, keyed by the card's name:
  //    - altName (second name): fill only when empty (preserve in-app edits)
  //    - category + class: set authoritatively (CSV is the source of truth)
  //    Also strip the retired `tags` field.
  const info = loadVehicleInfo();
  let namedCount = 0;
  for (const card of byId.values()) {
    if ('tags' in card) delete card.tags; // tags feature removed
    const v = info[card.deck] && info[card.deck].get(slug(card.name));
    if (!v) continue;
    if (!card.altName && v.secondary) { card.altName = v.secondary; namedCount += 1; }
    if (v.category) card.category = v.category; else delete card.category;
    if (v.class) card.class = v.class; else delete card.class;
  }

  // 3) Reconcile against file presence.
  //    - Standard cards: keep, flag missingImage (a vehicle is worth keeping even
  //      if its image is temporarily absent).
  //    - Alt cards: each is 1:1 with a specific image file, so PRUNE it when the
  //      file is gone (this is how renumbered/removed views drop out cleanly).
  let missingCount = 0;
  const missingNames = [];
  let prunedAlt = 0;
  const prunedNames = [];
  for (const [id, card] of [...byId.entries()]) {
    const present = card.image && diskPaths.has(card.image);
    if (present) {
      if ('missingImage' in card) delete card.missingImage;
    } else if (card.pov === 'alt') {
      byId.delete(id);
      prunedAlt += 1;
      prunedNames.push(`${card.deck}/${card.name} v${card.view ?? '?'}`);
    } else {
      card.missingImage = true;
      missingCount += 1;
      missingNames.push(`${card.deck || '?'}/${card.name || card.id}`);
    }
  }

  // 4) Deterministic order: deck, name, standard-before-alt, view, id.
  const cards = [...byId.values()].sort((a, b) => {
    return (
      String(a.deck).localeCompare(String(b.deck)) ||
      String(a.name).localeCompare(String(b.name)) ||
      ((a.pov === 'alt') - (b.pov === 'alt')) ||
      ((a.view || 0) - (b.view || 0)) ||
      String(a.id).localeCompare(String(b.id))
    );
  });

  const output = JSON.stringify(cards, null, 2) + '\n';
  const prevRaw = fs.existsSync(MANIFEST) ? fs.readFileSync(MANIFEST, 'utf8') : '';
  const changed = prevRaw !== output;
  if (changed) fs.writeFileSync(MANIFEST, output);

  // Per-deck totals split by pov.
  const perDeck = {};
  for (const c of cards) {
    const d = (perDeck[c.deck] = perDeck[c.deck] || { standard: 0, alt: 0 });
    if (c.pov === 'alt') d.alt += 1; else d.standard += 1;
  }

  console.log('--- build-manifest summary ---');
  console.log(`total cards:    ${cards.length}`);
  console.log(`new standard:   ${newStd}${newNames.length ? '  (' + newNames.join(', ') + ')' : ''}`);
  console.log(`new alt POVs:   ${newAlt}`);
  console.log('per-deck totals (standard / alt):');
  for (const deck of Object.keys(perDeck).sort()) {
    console.log(`  ${deck}: ${perDeck[deck].standard} / ${perDeck[deck].alt}`);
  }
  console.log(`missing images: ${missingCount}${missingNames.length ? '  (' + missingNames.slice(0, 20).join(', ') + (missingNames.length > 20 ? ', …' : '') + ')' : ''}`);
  console.log(`pruned alt views (file gone): ${prunedAlt}${prunedNames.length ? '  (' + prunedNames.join(', ') + ')' : ''}`);
  console.log(`second names backfilled from CSV: ${namedCount}`);
  console.log(`categorized (category+class): ${cards.filter((c) => c.category || c.class).length}`);
  if (unresolved.length) console.log(`UNRESOLVED alt images (${unresolved.length}): ${unresolved.join(', ')}`);
  console.log(`cards.json ${changed ? 'UPDATED' : 'unchanged'}`);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed ? 'true' : 'false'}\n`);
  }
}

main();
