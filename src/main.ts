import ESpeakNg from 'espeak-ng';
import wasmUrl from 'espeak-ng/dist/espeak-ng.wasm?url';
import hyphenNl from 'hyphen/nl';
import './style.css';
import { Phonetics, setHyphenator, type Token, type WordInfo } from './phonetics';
import { respell, tipsForWord } from './respell';
import {
  Speaker,
  loadSettings,
  saveSettings,
  listAzureVoices,
  clearCache,
  fetchAzure,
  DEFAULT_VOICES,
  type Settings,
  type Progress,
} from './audio';

setHyphenator(hyphenNl.hyphenateSync);

/* ------------------------------------------------------------------ setup */

async function loadModule(): Promise<WebAssembly.Module> {
  const res = await fetch(wasmUrl);
  try {
    if ('compileStreaming' in WebAssembly && res.headers.get('content-type')?.includes('application/wasm')) {
      return await WebAssembly.compileStreaming(res.clone());
    }
  } catch {
    /* fall through */
  }
  return WebAssembly.compile(await res.arrayBuffer());
}

const phonetics = new Phonetics(loadModule, ESpeakNg as never);
const speaker = new Speaker();
let azure: Settings = loadSettings();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Wrap runs of Arabic script so they pick up the Arabic face. */
const AR_RE = /([؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿][؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿\s]*)/g;
const wrapArabic = (s: string) => esc(s).replace(AR_RE, '<span class="ar-run">$1</span>');

/* ------------------------------------------------------------- preferences */

interface Prefs {
  lines: { ipa: boolean; en: boolean; fr: boolean; ar: boolean };
  engine: 'natural' | 'device';
  speed: number;
  dimWeak: boolean;
}
const PREFS_KEY = 'spreak.prefs.v2';
const DEFAULT_PREFS: Prefs = {
  lines: { ipa: true, en: true, fr: false, ar: false },
  engine: 'natural',
  speed: 0.9,
  dimWeak: true,
};
function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { ...DEFAULT_PREFS, ...raw, lines: { ...DEFAULT_PREFS.lines, ...(raw.lines ?? {}) } };
  } catch {
    return { ...DEFAULT_PREFS, lines: { ...DEFAULT_PREFS.lines } };
  }
}
let prefs: Prefs = loadPrefs();
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode */
  }
}

/* ------------------------------------------------------------------ recent */

const RECENT_KEY = 'spreak.recent.v1';
interface RecentItem { nl: string; en: string }
function loadRecent(): RecentItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.slice(0, 6) : [];
  } catch {
    return [];
  }
}
let recent: RecentItem[] = loadRecent();
function pushRecent(nl: string, en: string) {
  recent = [{ nl, en }, ...recent.filter((r) => r.nl !== nl)].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    /* ignore */
  }
  renderRecent();
}

/* ------------------------------------------------------------------- state */

let tokens: Token[] = [];
let words: WordInfo[] = [];
let selected = -1;
let seq = 0;

const SUGGESTIONS = [
  'Goedemorgen, hoe gaat het met u?',
  'Mag ik een glas water, alstublieft?',
];

/* ----------------------------------------------------------------- helpers */

const ICON = {
  play: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.8 3.1a.6.6 0 0 1 .92-.5l7 4.9a.6.6 0 0 1 0 1l-7 4.9a.6.6 0 0 1-.92-.5V3.1Z" fill="currentColor"/></svg>',
  chev: '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.9"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function stressClass(stress: number, weak: boolean) {
  if (weak) return '';
  return stress === 1 ? 's1' : stress === 2 ? 's2' : '';
}

function syllableHtml(w: WordInfo, weak: boolean): string {
  const parts = w.written ?? w.syllables.map((s) => s.ipa);
  return parts
    .map((p, i) => {
      const cls = stressClass(w.syllables[i]?.stress ?? 0, weak);
      return `${i ? '<span class="sep">·</span>' : ''}<span class="${cls}">${esc(p)}</span>`;
    })
    .join('');
}

function ipaHtml(w: WordInfo, weak: boolean): string {
  return w.syllables
    .map((s, i) => {
      const cls = stressClass(s.stress, weak);
      const mark = weak ? '' : s.stress === 1 ? 'ˈ' : s.stress === 2 ? 'ˌ' : '';
      return `${i ? '<span class="sep">.</span>' : ''}<span class="${cls}">${esc(mark + s.ipa)}</span>`;
    })
    .join('');
}

function respellHtml(parts: string[], w: WordInfo, weak: boolean, rtl = false): string {
  return parts
    .map((p, i) => {
      const stress = w.syllables[i]?.stress ?? 0;
      const cls = stressClass(stress, weak);
      const text = !rtl && !weak && stress === 1 ? p.toUpperCase() : p;
      const sep = rtl ? ' ' : '<span class="sep">-</span>';
      return `${i ? sep : ''}<span class="${cls}">${esc(text)}</span>`;
    })
    .join('');
}

function enPreview(ws: WordInfo[]): string {
  return ws
    .map((w) => {
      const r = respell(w.syllables);
      return r.en
        .map((p, i) => (w.syllables[i]?.stress === 1 && !w.weak ? p.toUpperCase() : p))
        .join('-');
    })
    .join(' ');
}

/* ------------------------------------------------------------- word chips */

function renderWords() {
  const results = $('results');
  const grid = $<HTMLDivElement>('words');
  if (!words.length) {
    results.hidden = true;
    grid.innerHTML = '';
    return;
  }
  results.hidden = false;
  const single = words.length === 1;
  let wi = 0;
  grid.innerHTML = tokens
    .map((t) => {
      if (t.kind === 'sep') return '';
      const i = wi++;
      const w = words[i];
      const weak = w.weak && !single && prefs.dimWeak;
      const r = respell(w.syllables);
      const lines: string[] = [`<span class="line syl">${syllableHtml(w, weak)}</span>`];
      if (prefs.lines.ipa) lines.push(`<span class="line ipa">${ipaHtml(w, weak)}</span>`);
      if (prefs.lines.en) lines.push(`<span class="line en">${respellHtml(r.en, w, weak)}</span>`);
      if (prefs.lines.fr) lines.push(`<span class="line fr">${respellHtml(r.fr, w, weak)}</span>`);
      if (prefs.lines.ar) lines.push(`<span class="line ar" dir="rtl">${respellHtml(r.ar, w, weak, true)}</span>`);
      const cls = ['chip', weak ? 'weak' : '', i === selected ? 'active' : ''].filter(Boolean).join(' ');
      const title = weak ? 'Usually unstressed in a sentence. Tap to hear it alone.' : 'Tap to hear this word';
      return `<button class="${cls}" type="button" data-i="${i}" title="${title}">${lines.join('')}</button>`;
    })
    .join('');
}

/* ------------------------------------------------------------ word detail */

function renderDetail() {
  const host = $('detail-col');
  const w = words[selected];
  // the detail column only claims grid space once there is something in it
  document.querySelector('.layout')?.classList.toggle('has-detail', !!w);
  if (!w) {
    host.innerHTML = '';
    return;
  }
  const r = respell(w.syllables);
  const tips = tipsForWord(w.syllables).slice(0, 3);
  const parts = w.written ?? w.syllables.map((s) => s.ipa);
  const primary = w.syllables.findIndex((s) => s.stress === 1);
  const secondary = w.syllables.findIndex((s) => s.stress === 2);

  const metaBits = [`${w.syllables.length} syllable${w.syllables.length > 1 ? 's' : ''}`];
  if (primary >= 0) metaBits.push(`main stress on <b>${esc(parts[primary])}</b>`);
  else metaBits.push('no main stress (weak word)');
  if (secondary >= 0) metaBits.push(`secondary on ${esc(parts[secondary])}`);
  if (w.overridden) metaBits.push('from your overrides');

  const rows = [
    ['IPA', `<span class="val ipa">${ipaHtml(w, false)}</span>`],
    ['EN', `<span class="val en">${respellHtml(r.en, w, false)}</span>`],
    ['FR', `<span class="val fr">${respellHtml(r.fr, w, false)}</span>`],
    ['AR', `<span class="val ar" dir="rtl">${respellHtml(r.ar, w, false, true)}</span>`],
  ]
    .map(([lab, val]) => `<div class="row"><span class="lab">${lab}</span>${val}</div>`)
    .join('');

  const tipHtml = tips
    .map(
      (t) => `<li class="tip">
        <div class="tip-head"><span class="spell">${esc(t.spell)}</span><span class="ipa">/${esc(t.ipa)}/</span><span class="ex">${esc(t.ex)}</span></div>
        <div class="tip-line en"><b>EN</b><span>${wrapArabic(t.en)}</span></div>
        <div class="tip-line fr"><b>FR</b><span>${wrapArabic(t.fr)}</span></div>
        <div class="tip-line ar"><b>AR</b><span>${wrapArabic(t.ar)}</span></div>
      </li>`,
    )
    .join('');

  host.innerHTML = `<div class="detail">
    <div class="detail-top">
      <div class="detail-word">${syllableHtml(w, false)}</div>
      <button class="pill" type="button" data-act="word">${ICON.play} Word</button>
    </div>
    <p class="detail-meta">${metaBits.join(' · ')}</p>
    <div class="rows">${rows}</div>
    ${tips.length ? `<p class="eyebrow" style="margin-top:16px">Sounds to watch</p><ul class="tips">${tipHtml}</ul>` : ''}
    <p class="legend-note">Capitals mark the main stress. The respelling is an approximation — lean on the French and Arabic anchors for the sounds English has no match for.</p>
  </div>`;
}

/* ----------------------------------------------------------------- recent */

function renderRecent() {
  const host = $('recent');
  const list = $('recent-list');
  if (!recent.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  list.innerHTML = recent
    .map(
      (r, i) => `<button class="recent-item" type="button" data-r="${i}">
        ${ICON.clock}
        <span class="ri-text"><span class="ri-nl">${esc(r.nl)}</span><span class="ri-en">${esc(r.en)}</span></span>
        <span class="ri-play">${ICON.play}</span>
      </button>`,
    )
    .join('');
}

/* --------------------------------------------------------------- analysis */

let debounce: number | undefined;
const textEl = $<HTMLTextAreaElement>('text');

function autoGrow() {
  textEl.style.height = 'auto';
  textEl.style.height = Math.min(textEl.scrollHeight, 180) + 'px';
  $('clear').hidden = textEl.value.length === 0;
}

function clearInput() {
  speaker.stop();
  textEl.value = '';
  autoGrow();
  clearTimeout(debounce);
  void analyse();
  textEl.focus();
}

async function analyse(): Promise<boolean> {
  const text = textEl.value.trim();
  const mine = ++seq;
  if (!text) {
    tokens = [];
    words = [];
    selected = -1;
    $('hero').hidden = false;
    renderWords();
    renderDetail();
    setStatus('');
    return false;
  }
  setStatus('Analysing…');
  try {
    const res = await phonetics.analyse(text);
    if (mine !== seq) return false;
    tokens = res.tokens;
    words = res.words;
    selected = words.length === 1 ? 0 : -1;
    $('hero').hidden = true;
    renderWords();
    renderDetail();
    setStatus('');
    return true;
  } catch (e) {
    console.error(e);
    setStatus('Could not analyse that. Try reloading the page.', true);
    return false;
  }
}

/* --------------------------------------------------------------- speaking */

function setStatus(msg: string, bad = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
}

function highlight(i: number) {
  document.querySelectorAll('.chip.playing').forEach((el) => el.classList.remove('playing'));
  if (i >= 0) document.querySelector(`.chip[data-i="${i}"]`)?.classList.add('playing');
}

/** Rough word boundaries as fractions of the clip, weighted by syllables and pauses. */
function wordTimeline(): number[] {
  const weights: number[] = [];
  let wi = 0;
  for (const t of tokens) {
    if (t.kind === 'word') {
      weights[wi] = Math.max(1, words[wi].syllables.length);
      wi++;
    } else if (wi > 0) {
      if (/[.?!]/.test(t.text)) weights[wi - 1] += 1.5;
      else if (/[,;:]/.test(t.text)) weights[wi - 1] += 0.8;
    }
  }
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return weights.map((w) => (acc += w) / total);
}

function effectiveSettings(): Settings {
  return prefs.engine === 'device' ? { ...azure, key: '' } : azure;
}

async function speak(text: string, rate: number, phrase: boolean) {
  if (!text.trim()) return;
  speaker.unlock();
  setStatus('Loading voice…');
  const ends = phrase ? wordTimeline() : [];
  const starts: number[] = [];
  if (phrase) {
    let pos = 0;
    for (const t of tokens) {
      if (t.kind === 'word') starts.push(pos);
      pos += t.text.length;
    }
  }
  const onProgress = (p: Progress) => {
    if (!phrase) return;
    if (p.fraction !== undefined) {
      if (p.fraction >= 1) return highlight(-1);
      const f = Math.max(0, p.fraction - 0.03);
      highlight(ends.findIndex((e) => f < e));
    } else if (p.charIndex !== undefined) {
      let idx = -1;
      starts.forEach((s, i) => {
        if (s <= p.charIndex!) idx = i;
      });
      highlight(idx);
    }
  };
  try {
    const r = await speaker.speak(text, effectiveSettings(), rate, onProgress);
    const label =
      r.engine === 'azure' ? 'Natural voice' : r.engine === 'cache' ? 'Saved clip' : 'Device voice';
    const voice = r.engine === 'browser' ? '' : ' · ' + azure.voice.replace('nl-NL-', '').replace('Neural', '');
    // when the user picked the device voice on purpose, the "no key" note is just noise
    const note = prefs.engine === 'device' || !r.note ? '' : ' · ' + r.note;
    setStatus(label + voice + note, r.engine === 'browser' && prefs.engine === 'natural' && !!azure.key);
  } finally {
    highlight(-1);
  }
}

async function run(rate: number) {
  const text = textEl.value.trim();
  if (!text) return;
  const ok = words.length ? true : await analyse();
  if (!ok) return;
  pushRecent(text, enPreview(words).slice(0, 90));
  await speak(text, rate, true);
}

/* --------------------------------------------------------------- settings */

const panel = document.createElement('div');
panel.className = 'settings';

function modesLabel(): string {
  const on = (['ipa', 'en', 'fr', 'ar'] as const).filter((k) => prefs.lines[k]).map((k) => k.toUpperCase());
  return on.length ? on.join(' · ') : 'Word only';
}

function renderPanel() {
  const L = prefs.lines;
  const toggle = (id: string, on: boolean) =>
    `<button class="toggle" type="button" role="switch" aria-pressed="${on}" data-toggle="${id}" aria-label="${id}"></button>`;
  const row = (id: string, title: string, sub: string, on: boolean, swatch?: string, subCls = '') =>
    `<div class="set-row">
      ${swatch ? `<span class="swatch" style="background:${swatch}"></span>` : ''}
      <span class="rtext"><span class="rtitle">${esc(title)}</span>${sub ? `<span class="rsub ${subCls}">${sub}</span>` : ''}</span>
      ${toggle(id, on)}
    </div>`;

  panel.innerHTML = `
    <h3 class="panel-title">Modes &amp; languages</h3>

    <p class="group">Voice</p>
    <div class="segmented" role="group" aria-label="Voice engine">
      <button type="button" data-engine="natural" aria-pressed="${prefs.engine === 'natural'}">Natural voice</button>
      <button type="button" data-engine="device" aria-pressed="${prefs.engine === 'device'}">Device voice</button>
    </div>
    <label class="key-field"><span>Which voice</span>
      <select id="voice-select">${[...new Set([azure.voice, ...DEFAULT_VOICES])]
        .map((v) => `<option value="${esc(v)}"${v === azure.voice ? ' selected' : ''}>${esc(v.replace('nl-NL-', '').replace('Neural', ''))}</option>`)
        .join('')}</select>
    </label>
    <label class="key-field"><span>Azure key</span>
      <input id="azure-key" type="password" autocomplete="off" spellcheck="false" value="${esc(azure.key)}" placeholder="paste KEY 1" />
    </label>
    <label class="key-field"><span>Region</span>
      <input id="azure-region" spellcheck="false" autocapitalize="off" value="${esc(azure.region)}" placeholder="switzerlandnorth" />
    </label>
    <div class="key-actions">
      <button class="pill ghost" type="button" data-act="test">Test</button>
      <button class="pill ghost" type="button" data-act="voices">Load voices</button>
      <button class="pill ghost" type="button" data-act="clear">Clear clips</button>
    </div>
    <p class="set-note" id="set-note">Your key is stored only in this browser and goes straight to Azure. Region for your resource: <b>switzerlandnorth</b>.</p>

    <p class="group">Speed</p>
    <div class="slider-head"><span>Playback</span><span class="val" id="speed-val">${prefs.speed.toFixed(1)}×</span></div>
    <input type="range" id="speed" min="0.5" max="1.3" step="0.05" value="${prefs.speed}" />

    <p class="group">Show under each word</p>
    ${row('ipa', 'IPA', 'ˈɣu.də.ˌmɔr.ɣən', L.ipa, 'var(--border-strong)', 'ipa')}
    ${row('en', 'English respelling', 'GHOO-duh-mor-ghuhn', L.en, 'var(--o-500)')}
    ${row('fr', 'French anchors', 'GHOU-de-mor-ghen', L.fr, 'var(--d-500)')}
    ${row('ar', 'Arabic anchors', 'غُو دِ مُرْ غِنْ', L.ar, 'var(--red-600)', 'ar')}

    <p class="group">Reading</p>
    ${row('dimWeak', 'Dim weak words', 'de, het, met, van …', prefs.dimWeak)}
  `;
  $('modes-label').textContent = modesLabel();
}

function placePanel() {
  const host = $('sheet-body');
  if (panel.parentElement !== host) host.appendChild(panel);
}

function openSheet() {
  const sheet = $('sheet');
  sheet.scrollTop = 0;
  sheet.classList.add('open');
  $('scrim').classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
}
function closeSheet() {
  $('sheet').classList.remove('open');
  $('scrim').classList.remove('open');
  $('sheet').setAttribute('aria-hidden', 'true');
}

function setNote(msg: string) {
  const n = panel.querySelector('#set-note');
  if (n) n.textContent = msg;
}

function readAzureForm(): Settings {
  const key = (panel.querySelector('#azure-key') as HTMLInputElement | null)?.value.trim() ?? azure.key;
  const region = (panel.querySelector('#azure-region') as HTMLInputElement | null)?.value.trim().toLowerCase() || 'switzerlandnorth';
  const voice = (panel.querySelector('#voice-select') as HTMLSelectElement | null)?.value || azure.voice;
  return { key, region, voice };
}

panel.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;

  const tog = t.closest('[data-toggle]') as HTMLElement | null;
  if (tog) {
    const id = tog.dataset.toggle!;
    if (id === 'dimWeak') prefs.dimWeak = !prefs.dimWeak;
    else prefs.lines[id as keyof Prefs['lines']] = !prefs.lines[id as keyof Prefs['lines']];
    savePrefs();
    tog.setAttribute('aria-pressed', String(id === 'dimWeak' ? prefs.dimWeak : prefs.lines[id as keyof Prefs['lines']]));
    $('modes-label').textContent = modesLabel();
    renderWords();
    return;
  }

  const eng = t.closest('[data-engine]') as HTMLElement | null;
  if (eng) {
    prefs.engine = eng.dataset.engine as Prefs['engine'];
    savePrefs();
    panel.querySelectorAll('[data-engine]').forEach((b) =>
      b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.engine === prefs.engine)),
    );
    setStatus(prefs.engine === 'device' ? 'Using the device voice.' : 'Using the natural Azure voice.');
    return;
  }

  const act = (t.closest('[data-act]') as HTMLElement | null)?.dataset.act;
  if (!act) return;
  if (act === 'clear') {
    await clearCache();
    setNote('Saved clips cleared.');
    return;
  }
  const form = readAzureForm();
  if (act === 'test') {
    speaker.unlock();
    setNote('Testing Azure…');
    try {
      const blob = await fetchAzure('Goedemorgen. Dit is Spreak.', form, 1);
      azure = form;
      saveSettings(azure);
      await new Audio(URL.createObjectURL(blob)).play();
      setNote('Works — key and region saved.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Test failed.');
    }
    return;
  }
  if (act === 'voices') {
    setNote('Loading voices…');
    try {
      const list = await listAzureVoices(form);
      azure = { ...form, voice: list.includes(form.voice) ? form.voice : list[0] ?? form.voice };
      saveSettings(azure);
      renderPanel();
      setNote(`${list.length} Dutch (nl-NL) voices found.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not load voices.');
    }
  }
});

panel.addEventListener('change', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'voice-select' || t.id === 'azure-key' || t.id === 'azure-region') {
    azure = readAzureForm();
    saveSettings(azure);
  }
});

panel.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'speed') {
    prefs.speed = Number(t.value);
    savePrefs();
    const v = panel.querySelector('#speed-val');
    if (v) v.textContent = prefs.speed.toFixed(1) + '×';
  }
});

/* ----------------------------------------------------------------- events */

$('settings-btn').addEventListener('click', openSheet);
$('sheet-done').addEventListener('click', closeSheet);
$('scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

textEl.addEventListener('input', () => {
  autoGrow();
  clearTimeout(debounce);
  debounce = window.setTimeout(() => void analyse(), 350);
});
textEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void run(prefs.speed);
  }
});

$('speak').addEventListener('click', () => void run(prefs.speed));
$('slow').addEventListener('click', () => void run(0.6));
$('send').addEventListener('click', () => void run(prefs.speed));
$('stop').addEventListener('click', () => {
  speaker.stop();
  highlight(-1);
  setStatus('');
});
$('clear').addEventListener('click', clearInput);
$('mic').addEventListener('click', () => setStatus('Dictation is not wired up yet — type or paste for now.'));
$('accent-btn').addEventListener('click', () =>
  setStatus('Standard Dutch (nl-NL), formal register. Belgian Dutch is on the list.'),
);

$('words').addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement).closest('.chip') as HTMLElement | null;
  if (!chip) return;
  selected = Number(chip.dataset.i);
  renderWords();
  renderDetail();
  void speak(words[selected].text, prefs.speed, false);
});

$('detail-col').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-act="word"]');
  if (btn && selected >= 0) void speak(words[selected].text, prefs.speed, false);
});

$('recent-list').addEventListener('click', async (e) => {
  const item = (e.target as HTMLElement).closest('[data-r]') as HTMLElement | null;
  if (!item) return;
  textEl.value = recent[Number(item.dataset.r)].nl;
  autoGrow();
  await run(prefs.speed);
});

$('suggestions').addEventListener('click', async (e) => {
  const s = (e.target as HTMLElement).closest('[data-s]') as HTMLElement | null;
  if (!s) return;
  textEl.value = SUGGESTIONS[Number(s.dataset.s)];
  autoGrow();
  await run(prefs.speed);
});

/* ------------------------------------------------------------------- boot */

$('suggestions').innerHTML = SUGGESTIONS.map(
  (s, i) => `<button class="suggestion" type="button" data-s="${i}"><span class="q">&ldquo;</span>${esc(s)}</button>`,
).join('');

renderPanel();
placePanel();
renderRecent();

const q = new URLSearchParams(location.search).get('q');
if (q) {
  textEl.value = q;
  autoGrow();
  void analyse();
}
if (!azure.key) setStatus('Add your Azure key in settings for the natural voice.');

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
