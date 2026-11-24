declare module 'espeak-ng' {
  const factory: (opts: unknown) => Promise<unknown>;
  export default factory;
}
declare module 'hyphen/nl' {
  export const hyphenateSync: (w: string, o: { hyphenChar: string; minWordLength: number }) => string;
  const m: { hyphenateSync: typeof hyphenateSync };
  export default m;
}
