// Splits an espeak-ng IPA string (one Dutch word) into syllables and tracks stress.
// espeak puts the stress mark (ˈ primary, ˌ secondary) right before the vowel it belongs to.

export interface Unit {
  type: 'V' | 'C';
  s: string;
}

export interface Syllable {
  units: Unit[];
  ipa: string;
  /** 0 = unstressed, 1 = primary, 2 = secondary */
  stress: 0 | 1 | 2;
}

const VOWEL_CHARS = new Set('aeiouyɑɛɪɔʏɵəøœɐʌʊɒæɜɨʉɯ');
const DIPHTHONGS = new Set(['ɛɪ', 'œy', 'ʌʊ', 'ɑu', 'ɔu', 'aɪ', 'ɔɪ', 'ɔy', 'ɪu']);
const AFFRICATES = new Set(['tʃ', 'dʒ']);
/** Short vowels that cannot end a stressed syllable on their own in Dutch (man-nen, not ma-nen). */
const SHORT_LAX = new Set(['ɑ', 'ɛ', 'ɪ', 'ɔ', 'ʏ', 'ɵ']);

const ONSETS_2 = new Set(
  (
    's p,s t,s k,s x,s l,s m,s n,s ʋ,s j,p l,b l,k l,ɣ l,f l,p r,b r,t r,d r,k r,ɣ r,f r,x r,x l,ʋ r,' +
    'k ʋ,t ʋ,d ʋ,z ʋ,ʃ t,ʃ p,ʃ k,ʃ l,ʃ m,ʃ n,ʃ r,ʃ ʋ,t s,p j,b j,k j,t j,d j,f j,m j,n j,l j'
  ).split(','),
);
const ONSETS_3 = new Set('s t r,s p r,s p l,s k r,s k l,s k ʋ,s x r,s x l'.split(','));

function legalOnset(cl: string[]): boolean {
  if (cl.length === 1) return cl[0] !== 'ŋ';
  const key = cl.join(' ');
  if (cl.length === 2) return ONSETS_2.has(key);
  if (cl.length === 3) return ONSETS_3.has(key);
  return false;
}

interface Tok extends Unit {
  stress: 0 | 1 | 2;
}

export function tokenize(ipa: string): Tok[] {
  const out: Tok[] = [];
  let pending: 0 | 1 | 2 = 0;
  const chars = Array.from(ipa.replace(/‍/g, ''));
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === 'ˈ') {
      pending = 1;
      continue;
    }
    if (c === 'ˌ') {
      pending = 2;
      continue;
    }
    if (/\s/.test(c)) continue;
    if (/[̀-ͯ]/.test(c) || c === 'ː' || c === 'ʲ' || c === 'ʰ') {
      if (out.length) out[out.length - 1].s += c;
      continue;
    }
    if (VOWEL_CHARS.has(c)) {
      let s = c;
      const pair = c + (chars[i + 1] ?? '');
      if (DIPHTHONGS.has(pair)) {
        s = pair;
        i++;
      }
      if (chars[i + 1] === 'ː') {
        s += 'ː';
        i++;
      }
      out.push({ type: 'V', s, stress: pending });
      pending = 0;
      continue;
    }
    const pair = c + (chars[i + 1] ?? '');
    if (AFFRICATES.has(pair)) {
      out.push({ type: 'C', s: pair, stress: 0 });
      i++;
      continue;
    }
    out.push({ type: 'C', s: c, stress: 0 });
  }
  return out;
}

export function syllabify(ipa: string): Syllable[] {
  const toks = tokenize(ipa);
  const nuclei = toks.map((t, i) => (t.type === 'V' ? i : -1)).filter((i) => i >= 0);
  if (nuclei.length === 0) {
    return [{ units: toks.map(({ type, s }) => ({ type, s })), ipa: toks.map((t) => t.s).join(''), stress: 0 }];
  }

  // boundaries[k] = index in toks where syllable k+1 starts
  const starts: number[] = [0];
  for (let k = 0; k < nuclei.length - 1; k++) {
    const a = nuclei[k];
    const b = nuclei[k + 1];
    const cluster = toks.slice(a + 1, b).map((t) => t.s);
    const n = cluster.length;
    let onset = n === 0 ? 0 : 1;
    for (let size = Math.min(n, 3); size >= 1; size--) {
      if (legalOnset(cluster.slice(n - size))) {
        onset = size;
        break;
      }
    }
    const prevBase = toks[a].s.replace('ː', '');
    if (SHORT_LAX.has(prevBase) && !toks[a].s.includes('ː') && n === 1) onset = 0;
    starts.push(b - onset);
  }

  const syllables: Syllable[] = [];
  for (let k = 0; k < nuclei.length; k++) {
    const from = starts[k];
    const to = k + 1 < starts.length ? starts[k + 1] : toks.length;
    const slice = toks.slice(from, to);
    syllables.push({
      units: slice.map(({ type, s }) => ({ type, s })),
      ipa: slice.map((t) => t.s).join(''),
      stress: toks[nuclei[k]].stress,
    });
  }
  return syllables;
}

/** Conventional IPA: stress mark at the start of the syllable, e.g. "ˈhɑn.də.ˌlaːr". */
export function formatIpa(syls: Syllable[]): string {
  return syls.map((s) => (s.stress === 1 ? 'ˈ' : s.stress === 2 ? 'ˌ' : '') + s.ipa).join('.');
}
