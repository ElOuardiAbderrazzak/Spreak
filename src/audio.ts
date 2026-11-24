// Speech output: Azure neural voice (key stored only on this device) -> IndexedDB cache -> browser voice.

export interface Settings {
  key: string;
  region: string;
  voice: string;
}

export const DEFAULT_VOICES = ['nl-NL-ColetteNeural', 'nl-NL-FennaNeural', 'nl-NL-MaartenNeural'];

const LS = 'spreak.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) ?? '{}');
    return { key: raw.key ?? '', region: raw.region ?? 'switzerlandnorth', voice: raw.voice ?? DEFAULT_VOICES[0] };
  } catch {
    return { key: '', region: 'switzerlandnorth', voice: DEFAULT_VOICES[0] };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(LS, JSON.stringify(s));
  } catch {
    /* storage can be blocked (private mode); the app still works for this session */
  }
}

// ---- tiny IndexedDB cache for generated clips ----
const DB = 'spreak';
const STORE = 'clips';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(key: string): Promise<Blob | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as Blob | undefined);
      r.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

async function cachePut(key: string, blob: Blob) {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key);
  } catch {
    /* cache is best effort */
  }
}

export async function clearCache() {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
  } catch {
    /* ignore */
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildSsml(text: string, voice: string, rate: number): string {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="nl-NL">` +
    `<voice name="${esc(voice)}"><prosody rate="${rate.toFixed(2)}">${esc(text)}</prosody></voice></speak>`
  );
}

export class SpeechError extends Error {
  constructor(
    message: string,
    public kind: 'auth' | 'quota' | 'network' | 'other',
  ) {
    super(message);
  }
}

export async function fetchAzure(text: string, s: Settings, rate: number): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`https://${s.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': s.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      },
      body: buildSsml(text, s.voice, rate),
    });
  } catch {
    throw new SpeechError('Could not reach Azure (offline, or the browser blocked the request).', 'network');
  }
  if (res.status === 401 || res.status === 403)
    throw new SpeechError('Azure rejected the key or region. Check them in settings.', 'auth');
  if (res.status === 429) throw new SpeechError('Azure free quota or rate limit reached.', 'quota');
  if (!res.ok) throw new SpeechError(`Azure error ${res.status}.`, 'other');
  return res.blob();
}

export async function listAzureVoices(s: Settings): Promise<string[]> {
  const res = await fetch(`https://${s.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { 'Ocp-Apim-Subscription-Key': s.key },
  });
  if (!res.ok) throw new SpeechError(`Voice list failed (${res.status}).`, res.status === 401 ? 'auth' : 'other');
  const all = (await res.json()) as { ShortName: string; Locale: string }[];
  return all.filter((v) => v.Locale === 'nl-NL').map((v) => v.ShortName).sort();
}

export type Engine = 'azure' | 'cache' | 'browser';

export interface Progress {
  /** 0..1 through the clip (Azure/cache), estimated */
  fraction?: number;
  /** character offset in the spoken text (browser voice, when supported) */
  charIndex?: number;
}

export interface SpeakResult {
  engine: Engine;
  note?: string;
}

// 100 ms of silence, used to unlock audio playback on iOS from the first tap
const SILENCE =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

export class Speaker {
  private audio = new Audio();
  private url: string | null = null;
  private token = 0;
  private unlocked = false;

  /** Call from a user gesture (tap) once; iOS only allows later async playback after this. */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.audio.src = SILENCE;
    void this.audio.play().catch(() => undefined);
  }

  stop() {
    this.token++;
    this.audio.pause();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  async speak(text: string, s: Settings, rate: number, onProgress?: (p: Progress) => void): Promise<SpeakResult> {
    const my = ++this.token;
    this.audio.pause();
    if ('speechSynthesis' in window) speechSynthesis.cancel();

    const cacheKey = `${s.voice}|${rate.toFixed(2)}|${text}`;
    let blob = await cacheGet(cacheKey);
    let engine: Engine = 'cache';
    let note: string | undefined;

    if (!blob && s.key) {
      try {
        blob = await fetchAzure(text, s, rate);
        engine = 'azure';
        void cachePut(cacheKey, blob);
      } catch (e) {
        note = e instanceof SpeechError ? e.message : 'Azure failed.';
      }
    } else if (!blob) {
      note = 'No Azure key set, so this is the built-in voice.';
    }
    if (my !== this.token) return { engine, note };

    if (blob) {
      await this.playBlob(blob, my, onProgress);
      return { engine, note };
    }
    await this.speakBrowser(text, rate, my, onProgress);
    return { engine: 'browser', note };
  }

  private playBlob(blob: Blob, my: number, onProgress?: (p: Progress) => void): Promise<void> {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    const a = this.audio;
    a.src = this.url;
    return new Promise((resolve) => {
      const tick = () => {
        if (my !== this.token) return;
        if (a.duration > 0) onProgress?.({ fraction: a.currentTime / a.duration });
        if (!a.paused && !a.ended) requestAnimationFrame(tick);
      };
      a.onended = () => {
        onProgress?.({ fraction: 1 });
        resolve();
      };
      a.onpause = () => {
        if (my !== this.token) resolve();
      };
      a.onerror = () => resolve();
      a.play()
        .then(() => requestAnimationFrame(tick))
        .catch(() => resolve());
    });
  }

  private speakBrowser(text: string, rate: number, my: number, onProgress?: (p: Progress) => void): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'nl-NL';
      u.rate = rate;
      const voices = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('nl'));
      const pick = voices.find((v) => v.lang.replace('_', '-').toLowerCase() === 'nl-nl') ?? voices[0];
      if (pick) u.voice = pick;
      u.onboundary = (e) => {
        if (my === this.token) onProgress?.({ charIndex: e.charIndex });
      };
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }
}
