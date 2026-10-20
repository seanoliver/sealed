// Client components import this module: never import pinyin-pro here.

/** Han run → one syllable per character, or a single reading over the whole run. */
export type Readings = Record<string, string[]>;

export type Run = { text: string; han: boolean };

const HAN_CHAR = /\p{Script=Han}/u;
const HAN_RUNS = /(\p{Script=Han}+)/u;

export const hasHan = (text: string | null | undefined): boolean =>
  text !== null && text !== undefined && HAN_CHAR.test(text);

export function hanRuns(text: string): Run[] {
  return text
    .split(HAN_RUNS)
    .map((part, i) => ({ text: part, han: i % 2 === 1 }))
    .filter((run) => run.text !== "");
}

const chars = (text: string) => Array.from(text);

const INITIAL = "(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])";
// Without an initial only a, o and e start a syllable (yi, wu, yu spell the rest).
const BARE_FINAL = "(?:ang|eng|ai|ei|ao|ou|an|en|er|a|o|e)";
const FINAL =
  "(?:iang|iong|uang|ueng|ang|eng|ing|ong|ian|iao|uai|uan|ai|ei|ao|ou|an|en|in|un|ia|ie|iu|ua|uo|ui|ue|er|a|o|e|i|u)";
const SYLLABLE = new RegExp(`^(?:${INITIAL}${FINAL}|${BARE_FINAL})r?$`);
const LONGEST = "zhuangr".length;
const SEPARATORS = /[\s\-'’·.]+/;

function baseLetter(char: string): string {
  return char
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/v/g, "u")
    .replace(/[^a-z]/g, "");
}

function tokenSplits(token: string): Map<number, string[]> {
  const units = chars(token.normalize("NFC"));
  const bases = units.map(baseLetter);
  type Split = { parts: string[]; bare: number };
  // from[i]: splits of units[i..], by syllable count.
  const from: Map<number, Split>[] = [];
  from[units.length] = new Map([[0, { parts: [], bare: 0 }]]);
  for (let start = units.length - 1; start >= 0; start--) {
    const here = new Map<number, Split>();
    // Joined pinyin needs an apostrophe before a, o or e: fewer of those wins ("nàna" → nà na).
    const bare = start > 0 && /^[aoe]/.test(bases[start]) ? 1 : 0;
    for (let end = Math.min(units.length, start + LONGEST); end > start; end--) {
      if (!SYLLABLE.test(bases.slice(start, end).join(""))) continue;
      const syllable = units.slice(start, end).join("");
      for (const [n, rest] of from[end]) {
        const best = here.get(n + 1);
        if (!best || rest.bare + bare < best.bare) {
          here.set(n + 1, { parts: [syllable, ...rest.parts], bare: rest.bare + bare });
        }
      }
    }
    from[start] = here;
  }
  return new Map([...from[0]].map(([n, split]) => [n, split.parts]));
}

export function splitReading(reading: string, count: number): string[] | null {
  const tokens = reading.trim().split(SEPARATORS).filter((t) => t !== "");
  if (tokens.length === 0 || count < 1) return null;
  let options = new Map<number, string[]>([[0, []]]);
  for (const token of tokens) {
    const splits = tokenSplits(token);
    if (splits.size === 0) return null;
    const next = new Map<number, string[]>();
    for (const [total, acc] of options) {
      for (const [n, parts] of splits) {
        if (total + n <= count && !next.has(total + n)) next.set(total + n, [...acc, ...parts]);
      }
    }
    options = next;
  }
  return options.get(count) ?? null;
}

export function overrideReadings({
  name,
  reading,
}: {
  name: string | null;
  reading: string | null;
}): Readings {
  const trimmed = reading?.trim() ?? "";
  if (!name || trimmed === "") return {};
  const runs = hanRuns(name).filter((run) => run.han);
  if (runs.length === 0) return {};
  const lengths = runs.map((run) => chars(run.text).length);
  const syllables = splitReading(trimmed, lengths.reduce((a, b) => a + b, 0));
  if (syllables) {
    let at = 0;
    return Object.fromEntries(
      runs.map((run, i) => {
        const part = syllables.slice(at, at + lengths[i]);
        at += lengths[i];
        return [run.text, part];
      }),
    );
  }
  if (runs.length === 1) return { [runs[0].text]: [trimmed] };
  const words = trimmed.split(/\s+/);
  return words.length === runs.length
    ? Object.fromEntries(runs.map((run, i) => [run.text, [words[i]]]))
    : {};
}

export function lookupRun(readings: Readings, run: string): string[] | null {
  const exact = readings[run];
  if (exact) return exact;
  const want = chars(run);
  for (const [key, syllables] of Object.entries(readings)) {
    const have = chars(key);
    if (have.length !== syllables.length) continue;
    for (let i = 0; i + want.length <= have.length; i++) {
      if (want.every((char, j) => have[i + j] === char)) {
        return syllables.slice(i, i + want.length);
      }
    }
  }
  return null;
}

export type RubyPart = { base: string; rt: string };
export type NameSegment =
  | { kind: "text"; text: string }
  | { kind: "ruby"; parts: RubyPart[] };

export function nameSegments(text: string, readings: Readings): NameSegment[] {
  return hanRuns(text).map((run): NameSegment => {
    const syllables = run.han ? lookupRun(readings, run.text) : null;
    if (!syllables) return { kind: "text", text: run.text };
    const runChars = chars(run.text);
    return {
      kind: "ruby",
      parts:
        syllables.length === runChars.length
          ? runChars.map((base, i) => ({ base, rt: syllables[i] }))
          : [{ base: run.text, rt: syllables.join(" ") }],
    };
  });
}

export function readingText(name: string, readings: Readings): string | null {
  const words = hanRuns(name)
    .filter((run) => run.han)
    .map((run) => lookupRun(readings, run.text));
  if (words.length === 0 || words.some((w) => w === null)) return null;
  // A capital starts a word: Zēng, Yǔ, tóng → "Zēng Yǔtóng".
  return (words as string[][])
    .map((syllables) =>
      syllables.reduce(
        (out, s, i) => (i > 0 && /^\p{Lu}/u.test(s) ? `${out} ${s}` : `${out}${s}`),
        "",
      ),
    )
    .join(" ");
}

export function pinyinKey(text: string): string {
  return chars(text).map(baseLetter).join("");
}

export function isPinyinQuery(query: string): boolean {
  return /^[\p{Script=Latin}\p{M}\s'’0-9-]+$/u.test(query.normalize("NFD")) && pinyinKey(query) !== "";
}

export function matchesReading({
  names,
  readings,
  query,
}: {
  names: readonly (string | null)[];
  readings: Readings;
  query: string;
}): boolean {
  if (!isPinyinQuery(query)) return false;
  const want = pinyinKey(query);
  return names.some((name) => {
    if (!name || !hasHan(name)) return false;
    const keys = hanRuns(name).map((run) =>
      run.han ? (lookupRun(readings, run.text) ?? []).join("") : run.text,
    );
    return pinyinKey(keys.join(" ")).includes(want);
  });
}
