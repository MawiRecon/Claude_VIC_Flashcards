// UI layer: wires the data model (store.js) + filters (filters.js) to the DOM.
// Deliberately the only module that touches the DOM, so the model stays reusable
// for the planned quiz / test modes.

import { DECKS, TOKEN_KEY } from './config.js';
import * as store from './store.js';
import { allTags, filterCards } from './filters.js';
import { shuffle } from './util.js';
import { initTest, startTest, isTestActive } from './test-mode.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  deck: 'All',
  tags: new Set(),
  filtered: [], // array of card objects, post-filter
  index: 0,
  flipped: false,
  editorOpen: false, // editor collapsed by default so the answer stays hidden
  shuffle: false,    // shuffle the working set in the viewer
  shuffleOrder: null,// the stable shuffled list, preserved across edits
  search: '',        // search query; when non-empty, the list view replaces the card
  token: localStorage.getItem(TOKEN_KEY) || '',
};

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

function refreshTokenUI() {
  const has = !!state.token;
  $('token-status').textContent = has ? 'token: set (this browser only)' : 'token: not set';
  $('token-status').classList.toggle('ok', has);
  $('btn-forget').hidden = !has;
  $('btn-token').textContent = has ? 'Change token' : 'Set token';
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

function renderDeckFilter() {
  const wrap = $('deck-filter');
  wrap.innerHTML = '';
  for (const deck of ['All', ...DECKS]) {
    const b = document.createElement('button');
    b.className = 'chip' + (state.deck === deck ? ' active' : '');
    b.textContent = deck;
    b.onclick = () => {
      state.deck = deck;
      applyFilters(true, true);
    };
    wrap.appendChild(b);
  }
}

function renderTagFilter() {
  const wrap = $('tag-filter');
  wrap.innerHTML = '';
  const tags = allTags(store.getCards());
  if (!tags.length) {
    wrap.innerHTML = '<span class="muted">no tags yet</span>';
    return;
  }
  for (const tag of tags) {
    const b = document.createElement('button');
    b.className = 'chip chip-tag' + (state.tags.has(tag) ? ' active' : '');
    b.textContent = tag;
    b.onclick = () => {
      if (state.tags.has(tag)) state.tags.delete(tag);
      else state.tags.add(tag);
      applyFilters(true, true);
    };
    wrap.appendChild(b);
  }
}

function applyFilters(resetIndex, reshuffle) {
  const base = filterCards(store.getCards(), { deck: state.deck, tags: state.tags });
  state.filtered = orderSet(base, reshuffle);
  if (resetIndex || state.index >= state.filtered.length) state.index = 0;
  state.flipped = false;
  if (resetIndex) state.editorOpen = false; // re-hide answer on filter changes, keep open across edits
  renderDeckFilter();
  renderTagFilter();
  renderView();
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

// Build the list of cards (within the current deck+tag filter) whose name OR a
// tag contains the query (case-insensitive substring).
function searchMatches() {
  const q = state.search.trim().toLowerCase();
  if (!q) return [];
  return state.filtered.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.tags || []).some((t) => t.toLowerCase().includes(q))
  );
}

function renderSearchResults() {
  const matches = searchMatches();
  $('search-count').textContent =
    `${matches.length} match${matches.length === 1 ? '' : 'es'} for “${state.search.trim()}”`;
  const list = $('search-results');
  list.innerHTML = '';
  for (const card of matches) {
    const row = document.createElement('button');
    row.className = 'search-row';
    const tags = (card.tags || []).map((t) => `<span class="search-tag">${escapeHtml(t)}</span>`).join('');
    row.innerHTML = `
      <img class="search-thumb" src="${escapeHtml(card.image)}" alt=""
           onerror="this.style.visibility='hidden'">
      <span class="search-info">
        <span class="search-name">${escapeHtml(card.name)}</span>
        <span class="search-deck">${escapeHtml(card.deck)}</span>
        <span class="search-tags">${tags}</span>
      </span>`;
    row.onclick = () => openCardFromSearch(card.id);
    list.appendChild(row);
  }
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
  $('card-deck').textContent = card.deck + (card.missingImage ? ' · (image missing)' : '');

  renderEditor(card);
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
  $('edit-deck').value = card.deck;

  // current tags as removable chips
  const tagsWrap = $('edit-tags');
  tagsWrap.innerHTML = '';
  for (const t of card.tags || []) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escapeHtml(t)} <button title="remove" aria-label="remove ${escapeHtml(t)}">×</button>`;
    chip.querySelector('button').onclick = () =>
      withFeedback(null, `Remove tag "${t}"`, async () => {
        if (!requireToken()) throw new Error('no token');
        await store.removeTag(card.id, t, state.token);
        afterMutation();
      });
    tagsWrap.appendChild(chip);
  }

  // datalist suggestions = all existing tags
  const dl = $('tag-suggestions');
  dl.innerHTML = '';
  for (const t of allTags(store.getCards())) {
    const o = document.createElement('option');
    o.value = t;
    dl.appendChild(o);
  }
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
    state.deck = 'All';
    state.tags.clear();
    applyFilters(true, true);
  });

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

  // practice test (uses the current filter; the test shuffles internally)
  $('btn-test').addEventListener('click', () => {
    const base = filterCards(store.getCards(), { deck: state.deck, tags: state.tags });
    if (!startTest(base)) toast('No cards in the current filter to test.', 'error');
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
      toast(state.token ? 'Token saved (browser only).' : 'Token cleared.', 'ok');
    }
    $('token-input').value = '';
  });
  $('btn-forget').addEventListener('click', () => {
    state.token = '';
    localStorage.removeItem(TOKEN_KEY);
    refreshTokenUI();
    toast('Token forgotten.', 'ok');
  });

  // editor: add tag
  $('btn-add-tag').addEventListener('click', (e) => {
    const card = currentCard();
    const tag = $('tag-input').value.trim();
    if (!card || !tag) return;
    withFeedback(e.currentTarget, `Add tag "${tag}"`, async () => {
      if (!requireToken()) throw new Error('no token');
      await store.addTag(card.id, tag, state.token);
      $('tag-input').value = '';
      afterMutation(card.id);
    });
  });
  $('tag-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('btn-add-tag').click(); }
  });

  // editor: save name
  $('btn-save-name').addEventListener('click', (e) => {
    const card = currentCard();
    if (!card) return;
    const name = $('edit-name').value.trim();
    if (!name || name === card.name) return;
    withFeedback(e.currentTarget, 'Rename card', async () => {
      if (!requireToken()) throw new Error('no token');
      await store.renameCard(card.id, name, state.token);
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
    if (state.deck !== 'All') sel.value = state.deck;
    $('new-name').value = '';
    $('new-tags').value = '';
    $('new-file').value = '';
    $('new-card-dialog').showModal();
  });
  $('new-card-dialog').addEventListener('close', () => {
    const dlg = $('new-card-dialog');
    if (dlg.returnValue !== 'create') return;
    const deck = $('new-deck').value;
    const name = $('new-name').value.trim();
    const file = $('new-file').files[0];
    const tags = $('new-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
    if (!name || !file) { toast('Name and image are required.', 'error'); return; }
    withFeedback($('btn-new-card'), 'Create card', async () => {
      const card = await store.createCard({ deck, name, file, tags }, state.token);
      // make sure the new deck/card is visible
      if (state.deck !== 'All' && state.deck !== deck) state.deck = 'All';
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
