// Rule-based respelling of Dutch IPA for an English / French / Arabic speaker.
// It is an approximation by design: each system uses its closest familiar sounds.

import type { Syllable, Unit } from './syllables';

interface Sound {
  en: string;
  fr: string;
  /** Arabic: consonants are letters; vowels start with a haraka (fatha/kasra/damma) that attaches to the previous letter. */
  ar: string;
}

const FATHA = 'َ';
const KASRA = 'ِ';
const DAMMA = 'ُ';
const SUKUN = 'ْ';

const SOUNDS: Record<string, Sound> = {
  // consonants
  b: { en: 'b', fr: 'b', ar: 'ب' },
  d: { en: 'd', fr: 'd', ar: 'د' },
  f: { en: 'f', fr: 'f', ar: 'ف' },
  ɡ: { en: 'g', fr: 'g', ar: 'گ' },
  g: { en: 'g', fr: 'g', ar: 'گ' },
  ɣ: { en: 'gh', fr: 'gh', ar: 'غ' },
  x: { en: 'kh', fr: 'kh', ar: 'خ' },
  h: { en: 'h', fr: 'h', ar: 'ه' },
  ɦ: { en: 'h', fr: 'h', ar: 'ه' },
  j: { en: 'y', fr: 'y', ar: 'ي' },
  k: { en: 'k', fr: 'k', ar: 'ك' },
  l: { en: 'l', fr: 'l', ar: 'ل' },
  m: { en: 'm', fr: 'm', ar: 'م' },
  n: { en: 'n', fr: 'n', ar: 'ن' },
  ŋ: { en: 'ng', fr: 'ng', ar: 'نغ' },
  p: { en: 'p', fr: 'p', ar: 'پ' },
  r: { en: 'r', fr: 'r', ar: 'ر' },
  ʀ: { en: 'r', fr: 'r', ar: 'ر' },
  ʁ: { en: 'r', fr: 'r', ar: 'ر' },
  s: { en: 's', fr: 's', ar: 'س' },
  ʃ: { en: 'sh', fr: 'ch', ar: 'ش' },
  ʒ: { en: 'zh', fr: 'j', ar: 'ژ' },
  t: { en: 't', fr: 't', ar: 'ت' },
  v: { en: 'v', fr: 'v', ar: 'ڤ' },
  ʋ: { en: 'v', fr: 'v', ar: 'ڤ' },
  w: { en: 'w', fr: 'w', ar: 'و' },
  z: { en: 'z', fr: 'z', ar: 'ز' },
  tʃ: { en: 'ch', fr: 'tch', ar: 'تش' },
  dʒ: { en: 'j', fr: 'dj', ar: 'ج' },
  // short vowels
  ɑ: { en: 'ah', fr: 'a', ar: FATHA },
  a: { en: 'ah', fr: 'a', ar: FATHA },
  ɛ: { en: 'eh', fr: 'è', ar: KASRA },
  ɪ: { en: 'ih', fr: 'i', ar: KASRA },
  i: { en: 'ee', fr: 'i', ar: KASRA + 'ي' },
  ɔ: { en: 'o', fr: 'o', ar: DAMMA },
  ʏ: { en: 'ü', fr: 'u', ar: DAMMA },
  ɵ: { en: 'ü', fr: 'u', ar: DAMMA },
  ə: { en: 'uh', fr: 'e', ar: KASRA },
  ɐ: { en: 'uh', fr: 'e', ar: FATHA },
  // long vowels (espeak writes Dutch oe / uu without the length mark: u, y)
  u: { en: 'oo', fr: 'ou', ar: DAMMA + 'و' },
  y: { en: 'üü', fr: 'u', ar: DAMMA + 'و' },
  'aː': { en: 'aa', fr: 'â', ar: FATHA + 'ا' },
  'eː': { en: 'ay', fr: 'é', ar: KASRA + 'ي' },
  'iː': { en: 'ee', fr: 'i', ar: KASRA + 'ي' },
  'oː': { en: 'oh', fr: 'ô', ar: DAMMA + 'و' },
  'uː': { en: 'oo', fr: 'ou', ar: DAMMA + 'و' },
  'yː': { en: 'üü', fr: 'u', ar: DAMMA + 'و' },
  'øː': { en: 'eu', fr: 'eu', ar: DAMMA + 'و' },
  'ɛː': { en: 'eh', fr: 'è', ar: KASRA },
  'ɔː': { en: 'aw', fr: 'o', ar: DAMMA },
  'œː': { en: 'eu', fr: 'eu', ar: DAMMA + 'و' },
  // diphthongs
  ɛɪ: { en: 'ei', fr: 'eï', ar: FATHA + 'ي' + SUKUN },
  œy: { en: 'öy', fr: 'œy', ar: DAMMA + 'ي' + SUKUN },
  ʌʊ: { en: 'ow', fr: 'aou', ar: FATHA + 'و' + SUKUN },
  ɑu: { en: 'ow', fr: 'aou', ar: FATHA + 'و' + SUKUN },
  ɔu: { en: 'ow', fr: 'aou', ar: FATHA + 'و' + SUKUN },
  aɪ: { en: 'eye', fr: 'aï', ar: FATHA + 'ي' + SUKUN },
  ɔɪ: { en: 'oy', fr: 'oï', ar: DAMMA + 'ي' + SUKUN },
  ɔy: { en: 'oy', fr: 'oï', ar: DAMMA + 'ي' + SUKUN },
};

/** Sounds where a pointer to a familiar sound in another language really helps. */
export interface Tip {
  /** how it is usually spelled in Dutch */
  spell: string;
  ex: string;
  en: string;
  fr: string;
  ar: string;
}

const TIPS: Record<string, Tip> = {
  x: { spell: 'ch / g', ex: 'acht', en: 'Scottish "loch": a rough, throaty hiss. English has no everyday match.', fr: 'Whisper the « r » of « rue »: same place in the throat, no voice.', ar: 'خ as in خبز. Exact match.' },
  ɣ: { spell: 'g', ex: 'goed', en: 'Voiced version of "loch": throaty, with the voice on. Never an English hard "g".', fr: 'The French « r » of « rue ». Almost identical.', ar: 'غ as in غرب. Exact match.' },
  ʏ: { spell: 'u (short)', ex: 'bus', en: 'No English match. Say "ih", then round your lips.', fr: '« u » of « lune », but shorter and a bit relaxed.', ar: 'Say ـُ with the tongue forward, as if saying ي.' },
  ɵ: { spell: 'u (short)', ex: 'bus', en: 'No English match. Say "ih", then round your lips.', fr: '« u » of « lune », but shorter and a bit relaxed.', ar: 'Say ـُ with the tongue forward, as if saying ي.' },
  y: { spell: 'uu / u', ex: 'nu', en: 'No English match. Say "ee" with rounded lips.', fr: '« u » of « lune ». Exact match.', ar: 'Say ي (ee) with rounded lips.' },
  'yː': { spell: 'uu / u', ex: 'nu', en: 'No English match. Say "ee" with rounded lips.', fr: '« u » of « lune ». Exact match.', ar: 'Say ي (ee) with rounded lips.' },
  'øː': { spell: 'eu', ex: 'deur', en: 'Like "ur" in "fur" but with rounded lips and no "r" sound.', fr: '« eu » of « peu ». Exact match.', ar: 'Say ـِي (ay) with rounded lips.' },
  œy: { spell: 'ui', ex: 'huis', en: 'Start like French "eu", glide to "ee". Not "ow" and not "oy".', fr: '« œil » + « y »: like the end of « feuille ».', ar: 'Rounded ـُ gliding to ي.' },
  ɛɪ: { spell: 'ij / ei', ex: 'tijd', en: '"eh" gliding to "ee": like "ay" in "may", but more open.', fr: '« è » + « ï »: like « ail » but starting from è.', ar: 'ـَيْ as in بَيْت, but start a bit more closed.' },
  ʌʊ: { spell: 'ou / au', ex: 'oud', en: 'Like "ow" in "cow", but start with a darker, rounder "o".', fr: '« aou » as in « caoutchouc ».', ar: 'ـَوْ as in لَوْن.' },
  ɑu: { spell: 'ou / au', ex: 'oud', en: 'Like "ow" in "cow", but start with a darker, rounder "o".', fr: '« aou » as in « caoutchouc ».', ar: 'ـَوْ as in لَوْن.' },
  ʋ: { spell: 'w', ex: 'water', en: 'Between "v" and "w": lips close to the teeth but not touching.', fr: 'Between « v » and the « ou » of « oui ».', ar: 'Between ڤ and و.' },
  r: { spell: 'r', ex: 'rood', en: 'Not the English "r". Roll or tap it, or use the French throaty r.', fr: 'The French « r » is fine (rolling is also fine).', ar: 'ر rolled is fine.' },
  ə: { spell: 'e (unstressed)', ex: 'de', en: 'A very weak "uh", like the "a" in "about".', fr: 'Like the very light « e » of « le ».', ar: 'A very light ـِ.' },
  'eː': { spell: 'ee', ex: 'twee', en: '"ay" but pure: no glide to "ee" at the end.', fr: '« é » of « été ». Already pure.', ar: 'ـِي pure, without a glide.' },
  'oː': { spell: 'oo', ex: 'boot', en: '"oh" but pure: no glide to "oo" at the end.', fr: '« ô » of « rôle ». Already pure.', ar: 'ـُو pure, without a glide.' },
  ɑ: { spell: 'a (short)', ex: 'kat', en: 'Short, between "cut" and "father".', fr: '« a » of « patte ».', ar: 'ـَ short.' },
  ɔ: { spell: 'o (short)', ex: 'pot', en: 'Like British "pot": short and rounded.', fr: '« o » of « porte ».', ar: 'ـُ short.' },
};

function soundOf(u: Unit): Sound {
  const direct = SOUNDS[u.s];
  if (direct) return direct;
  const base = u.s.replace(/[̀-ͯ]/g, '');
  if (SOUNDS[base]) return SOUNDS[base];
  const noLong = base.replace('ː', '');
  if (SOUNDS[noLong]) return SOUNDS[noLong];
  if (SOUNDS[noLong + 'ː']) return SOUNDS[noLong + 'ː'];
  return { en: u.s, fr: u.s, ar: '' };
}

export function tipFor(u: Unit): Tip | undefined {
  return TIPS[u.s] ?? TIPS[u.s.replace(/[̀-ͯ]/g, '')];
}

function arabicSyllable(units: Unit[], isWordStart: boolean): string {
  let out = '';
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const snd = soundOf(u);
    if (u.type === 'C') {
      out += snd.ar;
      const next = units[i + 1];
      // consonant not followed by a vowel gets a sukun so it is read as a bare consonant
      if (!next || next.type === 'C') out += SUKUN;
    } else {
      const prevIsConsonant = i > 0 && units[i - 1].type === 'C';
      if (!prevIsConsonant) out += isWordStart && i === 0 ? 'أ' : 'ء';
      out += snd.ar;
    }
  }
  return out;
}

export interface Respelling {
  en: string[];
  fr: string[];
  ar: string[];
}

export function respell(syls: Syllable[]): Respelling {
  return {
    en: syls.map((s) => s.units.map((u) => soundOf(u).en).join('')),
    fr: syls.map((s) => s.units.map((u) => soundOf(u).fr).join('')),
    ar: syls.map((s, i) => arabicSyllable(s.units, i === 0)),
  };
}

export interface SoundTip extends Tip {
  ipa: string;
}

/** Distinct tricky sounds in a word, in order of appearance. */
export function tipsForWord(syls: Syllable[]): SoundTip[] {
  const seen = new Set<string>();
  const out: SoundTip[] = [];
  for (const s of syls) {
    for (const u of s.units) {
      const t = tipFor(u);
      if (t && !seen.has(t.spell + t.ex)) {
        seen.add(t.spell + t.ex);
        out.push({ ...t, ipa: u.s });
      }
    }
  }
  return out;
}
