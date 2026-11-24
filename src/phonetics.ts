// Dutch text -> IPA (with stress) using espeak-ng compiled to WebAssembly.
// The wasm module is compiled once and re-instantiated per call (~90 ms), because the build
// does not export callMain for re-use.

import overrides from './overrides.json';
import { syllabify, formatIpa, type Syllable } from './syllables';

export type ModuleLoader = () => Promise<WebAssembly.Module>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ESpeakFactory = (opts: any) => Promise<any>;

export interface Token {
  kind: 'word' | 'sep';
  text: string;
}

export interface WordInfo {
  text: string;
  ipa: string;
  syllables: Syllable[];
  /** written syllables from hyphenation patterns, only when they line up with the spoken ones */
  written: string[] | null;
  weak: boolean;
  overridden: boolean;
}

const WORD_RE = /[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*|\d+(?:[.,]\d+)*/gu;

export function tokenizeText(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ kind: 'sep', text: text.slice(last, i) });
    out.push({ kind: 'word', text: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'sep', text: text.slice(last) });
  return out;
}

/** Small words that are normally unstressed inside a sentence. */
const WEAK = new Set(
  ('de het een en of maar want dus dat die dit deze er te om op in aan van met voor naar bij uit tot door over onder ' +
    'ik je jij u hij zij ze we wij jullie ons mijn uw zijn haar hun me mij je hem hen ' +
    'is ben bent zijn was waren heb hebt heeft hebben had hadden wordt worden word kan kunt kunnen zal zult zullen ' +
    'zou zouden moet moeten mag mogen wil wilt willen niet ook al nog dan als ').split(' '),
);

export function isWeak(word: string): boolean {
  return WEAK.has(word.toLowerCase());
}

type Hyphenate = (w: string, o: { hyphenChar: string; minWordLength: number }) => string;
let hyphenate: Hyphenate | null = null;
export function setHyphenator(fn: Hyphenate) {
  hyphenate = fn;
}

function writtenSyllables(word: string, spoken: number): string[] | null {
  if (!hyphenate || !/^\p{L}+$/u.test(word)) return null;
  const parts = hyphenate(word, { hyphenChar: '-', minWordLength: 1 }).split('-');
  return parts.length === spoken ? parts : null;
}

export class Phonetics {
  private cache = new Map<string, string>();
  private modP: Promise<WebAssembly.Module> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private loadModule: ModuleLoader,
    private espeak: ESpeakFactory,
  ) {}

  private mod() {
    return (this.modP ??= this.loadModule());
  }

  /** Runs espeak once on newline-separated lines and returns one IPA line per input line. */
  private async run(lines: string[]): Promise<string[]> {
    const mod = await this.mod();
    const text = lines.join('\n');
    const e = await this.espeak({
      arguments: ['--phonout', 'gen', '-q', '-b1', '--ipa=3', '-v', 'nl', '-f', 'in.txt'],
      print() {},
      printErr() {},
      preRun: [
        (m: { FS: { writeFile(p: string, d: Uint8Array): void } }) => {
          m.FS.writeFile('in.txt', new TextEncoder().encode(text));
        },
      ],
      instantiateWasm(imports: WebAssembly.Imports, ok: (i: WebAssembly.Instance) => void) {
        WebAssembly.instantiate(mod, imports).then((i) => ok(i));
        return {};
      },
    });
    const raw: string = e.FS.readFile('gen', { encoding: 'utf8' });
    return raw
      .replace(/‍/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** IPA for each word (same order). Uses overrides first, then espeak. */
  async ipaForWords(words: string[]): Promise<{ ipa: string; overridden: boolean }[]> {
    const result: { ipa: string; overridden: boolean }[] = new Array(words.length);
    const todo: number[] = [];
    words.forEach((w, i) => {
      const key = w.toLowerCase();
      const ov = (overrides as Record<string, string>)[key];
      if (ov) result[i] = { ipa: ov, overridden: true };
      else if (this.cache.has(key)) result[i] = { ipa: this.cache.get(key)!, overridden: false };
      else todo.push(i);
    });
    if (todo.length) {
      const uniq = [...new Set(todo.map((i) => words[i].toLowerCase()))];
      const lines = await this.enqueue(async () => {
        const batch = await this.run(uniq);
        if (batch.length === uniq.length) return batch;
        // line count drifted (numbers, odd input): fall back to one call per word
        const single: string[] = [];
        for (const w of uniq) single.push((await this.run([w])).join(' '));
        return single;
      });
      uniq.forEach((w, i) => this.cache.set(w, lines[i] ?? ''));
      for (const i of todo) result[i] = { ipa: this.cache.get(words[i].toLowerCase()) ?? '', overridden: false };
    }
    return result;
  }

  async analyse(text: string): Promise<{ tokens: Token[]; words: WordInfo[] }> {
    const tokens = tokenizeText(text);
    const raw = tokens.filter((t) => t.kind === 'word').map((t) => t.text);
    const ipas = await this.ipaForWords(raw);
    const words = raw.map((w, i): WordInfo => {
      const syllables = syllabify(ipas[i].ipa);
      return {
        text: w,
        ipa: formatIpa(syllables),
        syllables,
        written: writtenSyllables(w, syllables.length),
        weak: isWeak(w),
        overridden: ipas[i].overridden,
      };
    });
    return { tokens, words };
  }
}
