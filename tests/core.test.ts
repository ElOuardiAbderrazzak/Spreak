import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ESpeakNg from 'espeak-ng';
import { Phonetics, setHyphenator, tokenizeText } from '../src/phonetics';
import { syllabify, formatIpa } from '../src/syllables';
import { respell, tipsForWord } from '../src/respell';

const require = createRequire(import.meta.url);
setHyphenator(require('hyphen/nl').hyphenateSync);
const ph = new Phonetics(
  async () => WebAssembly.compile(await readFile('node_modules/espeak-ng/dist/espeak-ng.wasm')),
  ESpeakNg,
);

describe('syllabify', () => {
  it('splits handelaar with primary then secondary stress', () => {
    const s = syllabify('hˈɑndəlˌaːr');
    expect(s.map((x) => x.ipa)).toEqual(['hɑn', 'də', 'laːr']);
    expect(s.map((x) => x.stress)).toEqual([1, 0, 2]);
    expect(formatIpa(s)).toBe('ˈhɑn.də.ˌlaːr');
  });
  it('keeps a short stressed vowel closed (man-nen)', () => {
    expect(syllabify('mˈɑnən').map((x) => x.ipa)).toEqual(['mɑn', 'ən']);
  });
  it('lets a long vowel stay open (la-ten)', () => {
    expect(syllabify('lˈaːtən').map((x) => x.ipa)).toEqual(['laː', 'tən']);
  });
  it('treats ɛɪ and œy as one nucleus', () => {
    expect(syllabify('ˈœytɣˌɑŋ').map((x) => x.ipa)).toEqual(['œyt', 'ɣɑŋ']);
    expect(syllabify('kˈɔrtrɛɪk').length).toBe(2);
  });
  it('moves legal onset clusters to the next syllable', () => {
    expect(syllabify('ˌɑlstɵblˈift').map((x) => x.ipa)).toEqual(['ɑl', 'stɵ', 'blift']);
  });
});

describe('respell', () => {
  it('gives en/fr/ar for a word', () => {
    const r = respell(syllabify('ɣˈut'));
    expect(r.en.join('')).toBe('ghoot');
    expect(r.fr.join('')).toBe('ghou' + 't');
    expect(r.ar[0]).toContain('غ');
    expect(r.ar[0]).toContain('ت');
  });
  it('flags tricky sounds', () => {
    const tips = tipsForWord(syllabify('hˈœys'));
    expect(tips.map((t) => t.spell)).toContain('ui');
  });
});

describe('phonetics (espeak-ng wasm)', () => {
  it('gives stress for compounds and loanwords', async () => {
    const { words } = await ph.analyse('handelaar voetbalwedstrijd computer chocolade');
    expect(words.map((w) => w.ipa)).toEqual([
      'ˈhɑn.də.ˌlaːr',
      expect.stringMatching(/^ˈvut\.bɑl\.ˌʋɛt\.strɛɪt$/),
      'kɔm.ˈpju.tər',
      expect.stringMatching(/^ˌʃoː\.koː\.ˈlaː\.də$/),
    ]);
  });
  it('handles accents and sentences', async () => {
    const { tokens, words } = await ph.analyse('Één café, alstublieft!');
    expect(words.map((w) => w.text)).toEqual(['Één', 'café', 'alstublieft']);
    expect(words[0].ipa).toBe('ˈeːn');
    expect(tokens.at(-1)).toEqual({ kind: 'sep', text: '!' });
  });
  it('lines up written and spoken syllables when possible', async () => {
    const { words } = await ph.analyse('handelaar');
    expect(words[0].written).toEqual(['han', 'de', 'laar']);
  });
  it('tokenizes numbers and hyphenated words', () => {
    expect(tokenizeText('In 2024 e-mail').filter((t) => t.kind === 'word').map((t) => t.text)).toEqual(['In', '2024', 'e-mail']);
  });
});
