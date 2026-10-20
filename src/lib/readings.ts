// Client components import this module: never import pinyin-pro here.

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

function baseLetter(char: string): string {
  return char
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/v/g, "u")
    .replace(/[^a-z]/g, "");
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
    return {
      kind: "ruby",
      parts: chars(run.text).map((base, i) => ({ base, rt: syllables[i] })),
    };
  });
}

/** A run's syllables grouped into words: a capital starts one (Zēng, Yǔ, tóng → Zēng, Yǔtóng). */
function words(syllables: string[]): string[] {
  return syllables.reduce<string[]>(
    (out, s, i) =>
      i > 0 && /^\p{Lu}/u.test(s) ? [...out, s] : [...out.slice(0, -1), `${out.at(-1) ?? ""}${s}`],
    [],
  );
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
    const runs = hanRuns(name);
    const read = (run: Run) =>
      run.han ? (lookupRun(readings, run.text) ?? []).join("") : run.text;
    const han = runs.filter((run) => run.han).map((run) => lookupRun(readings, run.text) ?? []);
    const orders = [
      runs.map(read),
      [...han].reverse().map((syllables) => syllables.join("")),
      ...(han.length === 1 ? [[...words(han[0]).slice(1), ...words(han[0]).slice(0, 1)]] : []),
    ];
    return orders.some((order) => pinyinKey(order.join(" ")).includes(want));
  });
}
