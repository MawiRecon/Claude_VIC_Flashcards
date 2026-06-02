// Practice Test mode — a self-contained timed quiz that READS a set of cards
// and runs entirely in its own overlay. It never mutates the store, so it slots
// in alongside the study viewer without touching the data model.
//
// Flow per card: show image for LOOK_MS, then a blank recall screen for BLANK_MS,
// then advance. The answer input is live the whole time; Enter saves explicitly,
// and whatever is typed is also captured automatically when each phase ends.
// Scoring is lenient (case/space/dash-insensitive). The deck is always shuffled.

import { shuffle, normalizeAnswer } from './util.js';

const LOOK_MS = 8000;
const BLANK_MS = 5000;

const $ = (id) => document.getElementById(id);

// internal run state
let deck = [];        // shuffled cards for this run
let idx = 0;          // current card index
let answers = [];     // user answers, parallel to deck
let timers = [];      // active timeouts/intervals to clear on exit/advance
let lastBase = [];    // the unshuffled set, so Retake can reshuffle it
let lastLimit = 0;    // question cap from the last run (for Retake)

function clearTimers() {
  for (const t of timers) { clearTimeout(t); clearInterval(t); }
  timers = [];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Wire the static controls once (called from app.js on boot).
export function initTest() {
  $('test-exit').addEventListener('click', exitTest);
  $('test-close').addEventListener('click', exitTest);
  $('test-retake').addEventListener('click', () => startTest(lastBase, lastLimit));
  $('test-answer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveCurrent(true);
  });
  // Esc exits the test from anywhere in the overlay.
  $('test-overlay').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); exitTest(); }
  });
}

// Start a run from a base set. `limit` (optional) caps the number of questions
// (the deck is shuffled first, then sliced). Returns false if empty.
export function startTest(base, limit) {
  if (!base || !base.length) return false;
  lastBase = base;
  lastLimit = limit || 0;
  deck = shuffle(base);
  if (limit && limit > 0 && limit < deck.length) deck = deck.slice(0, limit);
  idx = 0;
  answers = new Array(deck.length).fill('');

  clearTimers();
  $('test-results').hidden = true;
  $('test-running').hidden = false;
  $('test-overlay').hidden = false;
  document.body.classList.add('test-active');
  runCard();
  return true;
}

function runCard() {
  clearTimers();
  const card = deck[idx];
  $('test-progress').textContent = `Card ${idx + 1} / ${deck.length}`;
  $('test-saved').hidden = true;

  const input = $('test-input');
  input.value = answers[idx] || '';
  input.disabled = false;
  input.focus();

  // LOOK phase: image visible.
  showImagePhase(card);
  startCountdown(LOOK_MS, () => {
    saveCurrent(false);          // capture anything typed during LOOK
    // BLANK phase: image hidden, recall and type.
    showBlankPhase();
    startCountdown(BLANK_MS, () => {
      saveCurrent(false);        // capture final answer
      advance();
    });
  });
}

function showImagePhase(card) {
  $('test-phase').textContent = 'Look';
  const img = $('test-img');
  const blank = $('test-blank');
  blank.hidden = true;
  img.hidden = false;
  // On a missing/broken image, show a neutral placeholder — never the name.
  img.onerror = () => {
    img.hidden = true;
    blank.hidden = false;
    blank.textContent = '(image unavailable)';
  };
  img.onload = () => { img.hidden = false; blank.hidden = true; };
  img.src = card.image;
}

function showBlankPhase() {
  $('test-phase').textContent = 'Answer';
  $('test-img').hidden = true;
  const blank = $('test-blank');
  blank.hidden = false;
  blank.textContent = 'Recall & type the name…';
  $('test-input').focus();
}

function startCountdown(ms, done) {
  let remaining = Math.ceil(ms / 1000);
  $('test-countdown').textContent = remaining;
  const iv = setInterval(() => {
    remaining -= 1;
    $('test-countdown').textContent = Math.max(remaining, 0);
  }, 1000);
  const to = setTimeout(() => { clearInterval(iv); done(); }, ms);
  timers.push(iv, to);
}

function saveCurrent(flash) {
  answers[idx] = $('test-input').value;
  if (flash) $('test-saved').hidden = false;
}

function advance() {
  idx += 1;
  if (idx >= deck.length) { finish(); return; }
  runCard();
}

function finish() {
  clearTimers();
  $('test-running').hidden = true;

  let correct = 0;
  const rows = deck.map((card, i) => {
    const ua = (answers[i] || '').trim();
    // Accept the name and the alternate name; also split multi-designation
    // strings like "FV-511 or FV-510" so either is accepted.
    const accepted = [card.name, card.altName]
      .filter(Boolean)
      .flatMap((n) => n.split(/\s+or\s+|[\/,]/))
      .map(normalizeAnswer)
      .filter(Boolean);
    const ok = !!ua && accepted.includes(normalizeAnswer(ua));
    if (ok) correct += 1;
    return { card, ua, ok };
  });

  const pct = Math.round((correct / deck.length) * 100);
  $('test-score').textContent = `Score: ${correct} / ${deck.length} (${pct}%)`;

  const list = $('test-results-list');
  list.innerHTML = '';
  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = `result-row ${r.ok ? 'ok' : 'bad'}`;
    row.innerHTML = `
      <img class="result-thumb" src="${escapeHtml(r.card.image)}" alt=""
           onerror="this.style.visibility='hidden'">
      <div class="result-meta">
        <div class="result-correct"><span class="label">Answer:</span>
          ${escapeHtml(r.card.name)} <span class="deck">(${escapeHtml(r.card.deck)})</span>
          ${r.card.altName ? `<span class="result-alt">also accepts: ${escapeHtml(r.card.altName)}</span>` : ''}</div>
        <div class="result-user"><span class="label">You:</span>
          ${r.ua ? escapeHtml(r.ua) : '<em>(blank)</em>'}
          <span class="mark">${r.ok ? '✓' : '✗'}</span></div>
      </div>`;
    list.appendChild(row);
  });

  $('test-results').hidden = false;
}

function exitTest() {
  clearTimers();
  $('test-overlay').hidden = true;
  $('test-running').hidden = true;
  $('test-results').hidden = true;
  document.body.classList.remove('test-active');
}

// Is a test currently on screen? (app.js uses this to suppress study hotkeys.)
export function isTestActive() {
  return !$('test-overlay').hidden;
}
