# Spreak

Type Dutch, hear it in a natural voice, and see **where the stress falls** — with the sounds respelled three ways: English, French and Arabic.

Runs entirely in the browser. Static site, no backend, no server-side secrets. Installable as a PWA.

![mascot](public/lion-head.png)

## What it does

- **Stress marking.** Every word is split into syllables with the primary stress in orange and underlined, and secondary stress in a lighter orange. Function words (*de, het, met, van*) are dimmed, because they're normally unstressed in a sentence.
- **Four lines per word, each toggleable:** IPA, English respelling, French anchors, Arabic anchors. The three respellings use different colours so they never blur together.
- **Tap any word** for a detail card: IPA, all three respellings, and "sounds to watch" — the handful of Dutch sounds English has no match for, each with the nearest French and Arabic equivalent.
- **Phrase mode.** Speak the whole sentence at normal or 0.6× speed, with the current word highlighted.

## How it works

| Piece | Implementation |
|---|---|
| Text → IPA + stress | `espeak-ng` compiled to WebAssembly, running in the browser. Corrections go in `src/overrides.json`. |
| Syllables | IPA split with Dutch onset rules (`src/syllables.ts`); written syllables from hyphenation patterns. |
| Respelling | Rule tables in `src/respell.ts` — edit `SOUNDS` and `TIPS` to tune the hints. |
| Voice | Azure Speech neural voice (nl-NL) on the **free F0 tier**. Clips cached in IndexedDB, so repeats cost nothing and work offline. Falls back to the device voice when there's no key. |
| Fonts | Self-hosted via `@fontsource` — Plus Jakarta Sans for UI, Inter for IPA, Noto Sans Arabic for Arabic runs. No CDN, works offline. |

The Azure key is typed into the app's settings and stored in that browser's local storage only. It is never committed, and requests go straight from the browser to Azure.

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm test
npm run build
```

## Azure

Resource `spreak-speech`, **Free F0** tier, region **`switzerlandnorth`** (the student subscription blocks West Europe). Portal → Keys and Endpoint → copy KEY 1, then paste it into Spreak's settings and press **Test**.

Free tier allowance is 0.5M characters of neural TTS per month.

## Design

The interface follows the Figma file `Spreak — Dutch pronunciation app`: Dutch orange `#FF6A00` for the brand and every stress mark, Delft blue `#2D5BD0` for the French line, flag red `#AE1C28` for the Arabic line, on a warm cream page. Tokens live at the top of `src/style.css` and mirror the Figma variable collection.

Breakpoints: single column below 768px with a settings bottom sheet, two columns to 1199px, three columns with a persistent settings rail from 1200px.

## Licence note

espeak-ng is GPL-3.0-or-later and is bundled, so keep this repo GPL-compatible.
