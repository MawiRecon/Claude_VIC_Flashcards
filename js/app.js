// UI layer: wires the data model (store.js) + filters (filters.js) to the DOM.
// Deliberately the only module that touches the DOM, so the model stays reusable
// for the planned quiz / test modes.

import { DECKS, TOKEN_KEY, PRACTICE_KEY } from './config.js';
import * as store from './store.js';
import { allClasses, allCategories, filterCards } from './filters.js';
import { shuffle } from './util.js';
import { initTest, startTest, isTestActive } from './test-mode.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  decks: new Set(),       // empty = All (multi-select)
  classes: new Set(),     // empty = All
  categories: new Set(),  // empty = All
  filtered: [], // array of card objects, post-filter
  index: 0,
  flipped: false,
  editorOpen: false, // editor collapsed by default so the answer stays hidden
  shuffle: false,    // shuffle the working set in the viewer
  shuffleOrder: null,// the stable shuffled list, preserved across edits
  pov: 'standard',   // 'standard' (default) | 'all' (include alternate viewpoints)
  search: '',        // search query; when non-empty, the list view replaces the card
  practice: loadPracticeSet(), // Set of card ids selected locally for practice
  practiceOnly: false,         // when true, restrict the working set to the practice set
  token: localStorage.getItem(TOKEN_KEY) || '',
};

// --- practice set (local, per-browser) -------------------------------------

function loadPracticeSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(PRACTICE_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}
function savePracticeSet() {
  localStorage.setItem(PRACTICE_KEY, JSON.stringify([...state.practice]));
}
// Called after the set changes: persist, refresh chips, and (if filtering by the
// set) re-apply filters so removed cards drop out.
function practiceChanged() {
  savePracticeSet();
  if (state.practiceOnly) applyFilters(false, false);
  updatePracticeUI();
}
function updatePracticeUI() {
  const n = state.practice.size;
  const chip = document.getElementById('btn-practice-filter');
  chip.textContent = `★ Practice set (${n})`;
  chip.classList.toggle('active', state.practiceOnly);
  chip.setAttribute('aria-pressed', String(state.practiceOnly));
  document.getElementById('btn-practice-clear').hidden = n === 0;
  const card = currentCard();
  const cb = document.getElementById('practice-check');
  cb.checked = !!card && state.practice.has(card.id);
  cb.disabled = !card;
}

// ---------------------------------------------------------------------------
// Tiny DOM helpers
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

function toast(msg, kind = 'info', ms = 3200) {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast toast-${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), ms);
}

// Wrap an async action with a busy button + standard success/error toasts.
async function withFeedback(btn, label, fn) {
  const prev = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    await fn();
    toast(`${label} — committed ✓`, 'ok');
  } catch (err) {
    console.error(err);
    toast(`${label} failed: ${err.message}`, 'error', 6000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prev; }
  }
}

// ---------------------------------------------------------------------------
// Token handling (the ONLY thing we persist locally)
// ---------------------------------------------------------------------------

// Edit mode is gated on having a token. With no token the app is a clean,
// read-only study/test experience (for friends): all editing chrome is hidden,
// leaving only a subtle "Owner sign-in" so the owner can still edit anywhere.
function refreshTokenUI() {
  const has = !!state.token;
  document.body.classList.toggle('read-only', !has);
  $('token-status').hidden = !has;
  $('token-status').textContent = has ? 'token: set (this browser only)' : '';
  $('token-status').classList.toggle('ok', has);
  $('btn-forget').hidden = !has;
  $('btn-new-card').hidden = !has;
  $('btn-token').textContent = has ? 'Change token' : 'Owner sign-in';
  if (!has) $('editor').hidden = true; // never show the editor in read-only mode
}

function requireToken() {
  if (state.token) return true;
  toast('Set a GitHub token first to commit changes.', 'error');
  $('token-dialog').showModal();
  return false;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

// Multi-select chip row. "All" is active when the set is empty and clears it;
// each option toggles membership. `onChange` re-applies filters.
function renderMultiFilter(wrapId, options, set, onChange) {
  const wrap = $(wrapId);
  wrap.innerHTML = '';
  wrap.appendChild(makeChip('All', set.size === 0, () => { set.clear(); onChange(); }));
  for (const opt of options) {
    wrap.appendChild(makeChip(opt, set.has(opt), () => {
      if (set.has(opt)) set.delete(opt); else set.add(opt);
      onChange();
    }));
  }
}

function renderDeckFilter() {
  renderMultiFilter('deck-filter', DECKS, state.decks, () => applyFilters(true, true));
}

function renderClassFilter() {
  renderMultiFilter('class-filter', allClasses(store.getCards()), state.classes, () => {
    pruneCategories(state.classes, state.categories); // keep category ⊆ selected classes
    applyFilters(true, true);
  });
}

function renderCategoryFilter() {
  // categories drill down from the selected class(es)
  renderMultiFilter('category-filter', allCategories(store.getCards(), state.classes), state.categories,
    () => applyFilters(true, true));
}

// Drop any selected categories that aren't within the selected classes.
function pruneCategories(classesSet, categoriesSet) {
  if (!classesSet.size) return;
  const valid = new Set(allCategories(store.getCards(), classesSet));
  for (const c of [...categoriesSet]) if (!valid.has(c)) categoriesSet.delete(c);
}

function applyFilters(resetIndex, reshuffle) {
  const base = filterCards(store.getCards(), {
    decks: state.decks, classes: state.classes, categories: state.categories,
    practiceOnly: state.practiceOnly, practiceSet: state.practice,
    pov: state.pov,
  });
  state.filtered = orderSet(base, reshuffle);
  if (resetIndex || state.index >= state.filtered.length) state.index = 0;
  state.flipped = false;
  if (resetIndex) state.editorOpen = false; // re-hide answer on filter changes, keep open across edits
  renderPovFilter();
  renderDeckFilter();
  renderClassFilter();
  renderCategoryFilter();
  renderView();
}

// POV control. Two exclusive modes — 'all' and 'standard' — plus three
// view-type subsets that select among the alternate views and can be combined.
// state.pov / testSetup.pov hold either the string 'all' | 'standard', or a Set
// of card `viewType` values (the subset selection). POV_SUBSETS maps each subset
// chip's data-pov token to the viewType it filters on.
const POV_SUBSETS = [
  { token: 'frontback', viewType: 'Front/Back' },
  { token: 'side', viewType: 'Side/Profile' },
  { token: 'top', viewType: 'Top' },
];
const POV_SUB_BY_TOKEN = new Map(POV_SUBSETS.map((s) => [s.token, s]));

// Copy a pov value (Set is cloned so two scopes don't share one selection).
function clonePov(pov) {
  return pov instanceof Set ? new Set(pov) : pov;
}

// Should the chip for `token` read as active, given the current `pov` value?
function povChipActive(pov, token) {
  const sub = POV_SUB_BY_TOKEN.get(token);
  if (sub) return pov instanceof Set && pov.has(sub.viewType);
  return pov === token; // 'all' / 'standard'
}

// Next pov value when `token` is clicked; null = no-op (ignore the click).
// 'all'/'standard' are exclusive; subset chips toggle within a Set and always
// keep at least one selected (clicking the last active subset is a no-op).
function nextPov(pov, token) {
  const sub = POV_SUB_BY_TOKEN.get(token);
  if (!sub) return pov === token ? null : token;
  const set = pov instanceof Set ? new Set(pov) : new Set();
  if (set.has(sub.viewType)) {
    if (set.size === 1) return null; // don't allow an empty subset selection
    set.delete(sub.viewType);
  } else {
    set.add(sub.viewType);
  }
  return set;
}

function renderPovFilter() {
  for (const b of document.querySelectorAll('#pov-filter [data-pov]')) {
    b.classList.toggle('active', povChipActive(state.pov, b.dataset.pov));
  }
}

// Switch between the single-card viewer and the search list view.
function renderView() {
  const searching = !!state.search.trim();
  $('search-list').hidden = !searching;
  document.querySelector('.stage').hidden = searching;
  if (searching) {
    $('editor').hidden = true;
    renderSearchResults();
  } else {
    renderCard();
  }
}

// Build the list of cards (within the current filter) whose name, second name,
// category, or class contains the query (case-insensitive substring).
function searchMatches() {
  const q = state.search.trim().toLowerCase();
  if (!q) return [];
  return state.filtered.filter((c) =>
    [c.name, c.altName, c.category, c.class].some((v) => (v || '').toLowerCase().includes(q))
  );
}

function renderSearchResults() {
  const matches = searchMatches();
  $('search-count').textContent =
    `${matches.length} match${matches.length === 1 ? '' : 'es'} for “${state.search.trim()}”`;
  const list = $('search-results');
  list.innerHTML = '';
  for (const card of matches) {
    const row = document.createElement('div');
    row.className = 'search-row';

    // practice checkbox (toggles the local set without leaving the list)
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'search-check';
    cb.title = 'Add to practice set';
    cb.checked = state.practice.has(card.id);
    cb.addEventListener('change', () => {
      if (cb.checked) state.practice.add(card.id);
      else state.practice.delete(card.id);
      practiceChanged();
    });

    // clickable area opens the card in the viewer
    const open = document.createElement('button');
    open.className = 'search-open';
    const meta = [card.deck, card.category].filter(Boolean).join(' · ');
    open.innerHTML = `
      <img class="search-thumb" src="${escapeHtml(card.image)}" alt=""
           onerror="this.style.visibility='hidden'">
      <span class="search-info">
        <span class="search-name">${escapeHtml(card.name)}</span>
        <span class="search-deck">${escapeHtml(meta)}</span>
      </span>`;
    open.onclick = () => openCardFromSearch(card.id);

    row.append(cb, open);
    list.appendChild(row);
  }
  updatePracticeUI();
}

// Click a result: clear the search and jump the viewer to that card.
function openCardFromSearch(id) {
  state.search = '';
  $('search-input').value = '';
  $('search-clear').hidden = true;
  const i = state.filtered.findIndex((c) => c.id === id);
  if (i >= 0) state.index = i;
  state.flipped = false;
  state.editorOpen = false;
  renderView();
}

// Decide the working order. When shuffle is off, natural (sorted) order. When on,
// generate a fresh shuffle on reshuffle/first use, else PRESERVE the existing
// shuffled order (so an edit doesn't reshuffle under the user) while reconciling
// any added/removed cards.
function orderSet(base, reshuffle) {
  if (!state.shuffle) { state.shuffleOrder = null; return base; }
  if (reshuffle || !state.shuffleOrder) {
    state.shuffleOrder = shuffle(base);
    return state.shuffleOrder;
  }
  const byId = new Map(base.map((c) => [c.id, c]));
  const kept = state.shuffleOrder.filter((c) => byId.has(c.id)).map((c) => byId.get(c.id));
  const keptIds = new Set(kept.map((c) => c.id));
  const added = base.filter((c) => !keptIds.has(c.id));
  state.shuffleOrder = [...kept, ...shuffle(added)];
  return state.shuffleOrder;
}

// ---------------------------------------------------------------------------
// Card viewer
// ---------------------------------------------------------------------------

function currentCard() {
  return state.filtered[state.index] || null;
}

function renderCard() {
  const card = currentCard();
  const img = $('card-img');
  const fallback = $('img-fallback');
  const front = document.querySelector('.card-front');
  const back = document.querySelector('.card-back');

  $('counter').textContent = `${state.filtered.length ? state.index + 1 : 0} / ${state.filtered.length}`;

  if (!card) {
    img.removeAttribute('src');
    fallback.hidden = false;
    fallback.textContent = 'No cards match this filter.';
    back.hidden = true;
    front.hidden = false;
    renderEditor(null);
    updatePracticeUI();
    return;
  }

  // Front: image (or name fallback on error / missing).
  fallback.hidden = true;
  img.hidden = false;
  img.alt = '';
  if (card.missingImage) {
    showImageFallback(card);
  } else {
    img.onerror = () => showImageFallback(card);
    img.onload = () => { img.hidden = false; fallback.hidden = true; };
    img.src = card.image; // relative path; browser encodes spaces
  }

  // Flip state.
  front.hidden = state.flipped;
  back.hidden = !state.flipped;
  $('card-name').textContent = card.name;
  $('card-altname').textContent = card.altName || '';
  $('card-altname').hidden = !card.altName;
  const povNote = card.pov === 'alt'
    ? ` · alt view${card.view ? ' ' + card.view : ''}${card.viewType ? ' (' + card.viewType + ')' : ''}`
    : '';
  const cat = card.category ? ` · ${card.category}` : '';
  $('card-deck').textContent = card.deck + cat + povNote + (card.missingImage ? ' · (image missing)' : '');

  renderEditor(card);
  updatePracticeUI();
}

function showImageFallback(card) {
  const img = $('card-img');
  const fallback = $('img-fallback');
  img.hidden = true;
  fallback.hidden = false;
  fallback.textContent = card.name; // graceful: show the answer text
}

function flip() {
  if (state.search.trim() || !currentCard()) return;
  state.flipped = !state.flipped;
  renderCard();
}

function go(delta) {
  if (state.search.trim() || !state.filtered.length) return;
  state.index = (state.index + delta + state.filtered.length) % state.filtered.length;
  state.flipped = false;
  state.editorOpen = false; // navigating to a new card re-hides the answer
  renderCard();
}

// ---------------------------------------------------------------------------
// Editor for the current card
// ---------------------------------------------------------------------------

function renderEditor(card) {
  const editor = $('editor');
  if (!state.token) { editor.hidden = true; return; } // read-only: no editor at all
  if (!card) { editor.hidden = true; return; }
  editor.hidden = false;

  // Collapsed by default: the body holds the name (answer), so keep it hidden
  // until the user explicitly expands it.
  const body = $('editor-body');
  const toggle = $('editor-toggle');
  body.hidden = !state.editorOpen;
  toggle.setAttribute('aria-expanded', String(state.editorOpen));
  toggle.classList.toggle('open', state.editorOpen);

  $('edit-name').value = card.name;
  $('edit-alt').value = card.altName || '';
  $('edit-deck').value = card.deck;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Re-run filters + render after any data mutation, keeping the user on the same
// card id when possible.
function afterMutation(keepId) {
  const id = keepId ?? currentCard()?.id;
  applyFilters(false, false); // preserve current (possibly shuffled) order across edits
  if (id) {
    const i = state.filtered.findIndex((c) => c.id === id);
    if (i >= 0) state.index = i;
  }
  state.flipped = false;
  renderView();
}

// ---------------------------------------------------------------------------
// Practice Test setup (choose country / POV / class / category / count first)
// ---------------------------------------------------------------------------

const COUNTS = [10, 25, 50];
const testSetup = { decks: new Set(), pov: 'standard', classes: new Set(), categories: new Set(), count: 0, practiceOnly: false };

function makeChip(label, active, onclick, extra) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (extra ? ' ' + extra : '') + (active ? ' active' : '');
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

function openTestSetup() {
  testSetup.decks = new Set(state.decks);
  testSetup.pov = clonePov(state.pov);
  testSetup.classes = new Set(state.classes);
  testSetup.categories = new Set(state.categories);
  testSetup.count = 0;
  testSetup.practiceOnly = state.practiceOnly && state.practice.size > 0;
  renderTestSetup();
  $('test-setup-dialog').showModal();
}

function setupBase() {
  return filterCards(store.getCards(), {
    decks: testSetup.decks, classes: testSetup.classes, categories: testSetup.categories, pov: testSetup.pov,
    practiceOnly: testSetup.practiceOnly, practiceSet: state.practice,
  });
}

function renderTestSetup() {
  renderMultiFilter('setup-deck', DECKS, testSetup.decks, renderTestSetup);

  for (const b of document.querySelectorAll('#setup-pov [data-pov]')) {
    b.classList.toggle('active', povChipActive(testSetup.pov, b.dataset.pov));
    b.onclick = () => {
      const next = nextPov(testSetup.pov, b.dataset.pov);
      if (next === null) return;
      testSetup.pov = next;
      renderTestSetup();
    };
  }

  renderMultiFilter('setup-class', allClasses(store.getCards()), testSetup.classes, () => {
    pruneCategories(testSetup.classes, testSetup.categories);
    renderTestSetup();
  });
  renderMultiFilter('setup-category', allCategories(store.getCards(), testSetup.classes), testSetup.categories, renderTestSetup);

  // Practice-set option only when the user has a non-empty set.
  const hasSet = state.practice.size > 0;
  $('setup-practice-group').hidden = !hasSet;
  if (hasSet) {
    const pw = $('setup-practice');
    pw.innerHTML = '';
    pw.appendChild(makeChip(`★ Only my set (${state.practice.size})`, testSetup.practiceOnly, () => {
      testSetup.practiceOnly = !testSetup.practiceOnly;
      renderTestSetup();
    }));
  } else {
    testSetup.practiceOnly = false;
  }

  const countWrap = $('setup-count');
  countWrap.innerHTML = '';
  for (const n of [...COUNTS, 0]) {
    countWrap.appendChild(makeChip(n === 0 ? 'All' : String(n), testSetup.count === n, () => {
      testSetup.count = n; renderTestSetup();
    }));
  }

  const pool = setupBase().length;
  const willTest = testSetup.count && testSetup.count < pool ? testSetup.count : pool;
  $('setup-pool').textContent = pool
    ? `${pool} cards available — testing ${willTest}`
    : 'No cards match these settings';
  $('setup-start').disabled = pool === 0;
}

function wireTestSetup() {
  $('test-setup-dialog').addEventListener('close', () => {
    if ($('test-setup-dialog').returnValue !== 'start') return;
    if (!startTest(setupBase(), testSetup.count)) toast('No cards match these settings.', 'error');
  });
}

// ---------------------------------------------------------------------------
// Jump to vehicle (browse standard cards grouped by country)
// ---------------------------------------------------------------------------

function openJump() {
  $('jump-filter').value = '';
  renderJumpList('');
  $('jump-dialog').showModal();
  $('jump-filter').focus();
}

function renderJumpList(q) {
  const query = q.trim().toLowerCase();
  const list = $('jump-list');
  list.innerHTML = '';
  const vehicles = store.getCards().filter((c) => c.pov !== 'alt'); // one entry per vehicle
  for (const deck of DECKS) {
    let items = vehicles.filter((c) => c.deck === deck);
    if (query) {
      items = items.filter((c) =>
        c.name.toLowerCase().includes(query) || (c.altName || '').toLowerCase().includes(query));
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    if (!items.length) continue;
    const h = document.createElement('h3');
    h.className = 'jump-country';
    h.textContent = `${deck} (${items.length})`;
    list.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'jump-grid';
    for (const c of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'jump-item';
      b.textContent = c.name;
      b.onclick = () => { $('jump-dialog').close(); jumpToVehicle(c.id); };
      grid.appendChild(b);
    }
    list.appendChild(grid);
  }
  if (!list.children.length) list.innerHTML = '<p class="muted">No vehicles match.</p>';
}

// Jump scopes the viewer to that vehicle's country and clears other filters.
function jumpToVehicle(id) {
  const card = store.findById(id);
  if (!card) return;
  state.decks = new Set([card.deck]);
  state.classes.clear();
  state.categories.clear();
  state.practiceOnly = false;
  state.search = '';
  $('search-input').value = '';
  $('search-clear').hidden = true;
  applyFilters(true, false);
  const i = state.filtered.findIndex((c) => c.id === id);
  if (i >= 0) state.index = i;
  state.flipped = false;
  renderView();
}

function wireJump() {
  $('btn-jump').addEventListener('click', openJump);
  $('jump-close').addEventListener('click', () => $('jump-dialog').close());
  $('jump-filter').addEventListener('input', (e) => renderJumpList(e.target.value));
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wireEvents() {
  // viewer
  $('card').addEventListener('click', flip);
  $('btn-prev').addEventListener('click', () => go(-1));
  $('btn-next').addEventListener('click', () => go(1));
  document.addEventListener('keydown', (e) => {
    if (isTestActive()) return; // the test overlay owns the keyboard
    if (e.target.matches('input, textarea, select') || document.querySelector('dialog[open]')) return;
    if (e.code === 'Space') { e.preventDefault(); flip(); }
    else if (e.code === 'ArrowLeft') go(-1);
    else if (e.code === 'ArrowRight') go(1);
  });

  // touch: swipe left/right to navigate (tap still flips)
  let touchX = 0, touchY = 0;
  $('card').addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; touchX = t.clientX; touchY = t.clientY;
  }, { passive: true });
  $('card').addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX, dy = t.clientY - touchY;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault(); // suppress the click->flip that follows a swipe
      go(dx < 0 ? 1 : -1);
    }
  }, { passive: false });

  // mobile: collapse/expand the filter groups
  $('btn-filters-toggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('filters-open');
    $('btn-filters-toggle').setAttribute('aria-expanded', String(open));
  });

  // editor expand/collapse (hidden by default to avoid spoiling the answer)
  $('editor-toggle').addEventListener('click', () => {
    state.editorOpen = !state.editorOpen;
    renderEditor(currentCard());
  });

  // search
  $('search-input').addEventListener('input', (e) => {
    state.search = e.target.value;
    $('search-clear').hidden = !state.search.trim();
    renderView();
  });
  $('search-clear').addEventListener('click', () => {
    state.search = '';
    $('search-input').value = '';
    $('search-clear').hidden = true;
    renderView();
  });

  // filters
  $('btn-clear-filters').addEventListener('click', () => {
    state.decks.clear();
    state.classes.clear();
    state.categories.clear();
    applyFilters(true, true);
  });

  // POV selector (All / Standard + Front-Back / Side / Top subsets)
  for (const b of document.querySelectorAll('#pov-filter [data-pov]')) {
    b.addEventListener('click', () => {
      const next = nextPov(state.pov, b.dataset.pov);
      if (next === null) return;
      state.pov = next;
      applyFilters(true, true);
    });
  }

  // shuffle toggle + reshuffle
  $('btn-shuffle').addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    const btn = $('btn-shuffle');
    btn.classList.toggle('active', state.shuffle);
    btn.setAttribute('aria-pressed', String(state.shuffle));
    $('btn-reshuffle').hidden = !state.shuffle;
    applyFilters(true, true);
  });
  $('btn-reshuffle').addEventListener('click', () => applyFilters(true, true));

  // practice test -> open the setup dialog (choose country/POV/tags/count first)
  $('btn-test').addEventListener('click', openTestSetup);
  wireTestSetup();
  wireJump();

  // practice set: per-card checkbox, filter chip, clear
  $('practice-check').addEventListener('change', (e) => {
    const card = currentCard();
    if (!card) return;
    if (e.target.checked) state.practice.add(card.id);
    else state.practice.delete(card.id);
    practiceChanged();
  });
  $('btn-practice-filter').addEventListener('click', () => {
    state.practiceOnly = !state.practiceOnly;
    applyFilters(true, true);
    updatePracticeUI();
  });
  $('btn-practice-clear').addEventListener('click', () => {
    if (!state.practice.size) return;
    if (!confirm('Clear your practice set?')) return;
    state.practice.clear();
    savePracticeSet();
    applyFilters(true, true);
    updatePracticeUI();
  });

  // token
  $('btn-token').addEventListener('click', () => {
    $('token-input').value = state.token;
    $('token-dialog').showModal();
  });
  $('token-dialog').addEventListener('close', () => {
    if ($('token-dialog').returnValue === 'save') {
      state.token = $('token-input').value.trim();
      if (state.token) localStorage.setItem(TOKEN_KEY, state.token);
      else localStorage.removeItem(TOKEN_KEY);
      refreshTokenUI();
      renderView(); // show/hide the editor for the current card immediately
      toast(state.token ? 'Signed in — editing enabled.' : 'Token cleared.', 'ok');
    }
    $('token-input').value = '';
  });
  $('btn-forget').addEventListener('click', () => {
    state.token = '';
    localStorage.removeItem(TOKEN_KEY);
    refreshTokenUI();
    renderView(); // collapse back to read-only view
    toast('Signed out — read-only.', 'ok');
  });


  // editor: save name + alternative name (one commit)
  $('btn-save-name').addEventListener('click', (e) => {
    const card = currentCard();
    if (!card) return;
    const name = $('edit-name').value.trim();
    const alt = $('edit-alt').value.trim();
    if (!name) { toast('Name cannot be empty.', 'error'); return; }
    if (name === card.name && alt === (card.altName || '')) return; // nothing changed
    withFeedback(e.currentTarget, 'Save name(s)', async () => {
      if (!requireToken()) throw new Error('no token');
      await store.editCardNames(card.id, name, alt, state.token);
      afterMutation(card.id);
    });
  });

  // editor: replace image
  $('btn-replace-img').addEventListener('click', () => {
    if (!currentCard() || !requireToken()) return;
    $('file-replace').click();
  });
  $('file-replace').addEventListener('change', (e) => {
    const card = currentCard();
    const file = e.target.files[0];
    if (!card || !file) return;
    withFeedback($('btn-replace-img'), 'Replace image', async () => {
      await store.replaceImage(card.id, file, state.token);
      afterMutation(card.id);
    });
    e.target.value = '';
  });

  // editor: duplicate
  $('btn-duplicate').addEventListener('click', (e) => {
    const card = currentCard();
    if (!card) return;
    withFeedback(e.currentTarget, 'Duplicate card', async () => {
      if (!requireToken()) throw new Error('no token');
      const dup = await store.duplicateCard(card.id, state.token);
      afterMutation(dup.id);
    });
  });

  // editor: delete
  $('btn-delete').addEventListener('click', (e) => {
    const card = currentCard();
    if (!card) return;
    if (!confirm(`Delete "${card.name}" (${card.deck})? This also removes its image file unless shared.`)) return;
    withFeedback(e.currentTarget, 'Delete card', async () => {
      if (!requireToken()) throw new Error('no token');
      await store.deleteCard(card.id, state.token);
      afterMutation();
    });
  });

  // new card dialog
  $('btn-new-card').addEventListener('click', () => {
    if (!requireToken()) return;
    const sel = $('new-deck');
    sel.innerHTML = DECKS.map((d) => `<option>${d}</option>`).join('');
    if (state.decks.size === 1) sel.value = [...state.decks][0]; // pre-fill if exactly one country filtered
    $('new-name').value = '';
    $('new-file').value = '';
    $('new-card-dialog').showModal();
  });
  $('new-card-dialog').addEventListener('close', () => {
    const dlg = $('new-card-dialog');
    if (dlg.returnValue !== 'create') return;
    const deck = $('new-deck').value;
    const name = $('new-name').value.trim();
    const file = $('new-file').files[0];
    if (!name || !file) { toast('Name and image are required.', 'error'); return; }
    withFeedback($('btn-new-card'), 'Create card', async () => {
      const card = await store.createCard({ deck, name, file }, state.token);
      // make sure the new card is visible (clear a country filter that would hide it)
      if (state.decks.size && !state.decks.has(deck)) state.decks.clear();
      afterMutation(card.id);
    });
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  wireEvents();
  initTest();
  refreshTokenUI();
  try {
    await store.loadCards();
    applyFilters(true, false);
    if (!store.getCards().length) toast('No cards in cards.json yet.', 'info');
  } catch (err) {
    console.error(err);
    toast(`Failed to load cards.json: ${err.message}`, 'error', 8000);
  }
}

init();
