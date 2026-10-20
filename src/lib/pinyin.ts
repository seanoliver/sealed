import "server-only";
import { hanRuns, hasHan, lookupRun, type Readings } from "@/lib/readings";

type PinyinFn = typeof import("pinyin-pro").pinyin;

// pinyin-pro is megabytes of dictionary: load it only once a name needs it.
let loading: Promise<PinyinFn> | null = null;

function loadPinyin(): Promise<PinyinFn> {
  loading ??= import("pinyin-pro").then(
    (m) => m.pinyin,
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}

const COMPOUND_SURNAMES = new Set([
  "欧阳", "司马", "诸葛", "上官", "司徒", "东方", "皇甫", "尉迟", "公孙", "慕容",
  "令狐", "夏侯", "长孙", "宇文", "轩辕", "端木", "澹台", "呼延", "独孤", "南宫",
  "西门", "百里", "东郭", "闻人", "申屠", "太史", "万俟", "钟离", "濮阳", "淳于",
]);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const word = (parts: string[]) => parts.map((s, i) => (i === 0 ? capitalize(s) : s));

function syllables(pinyin: PinyinFn, run: string, { surname }: { surname: boolean }): string[] {
  const chars = Array.from(run);
  const result = pinyin(run, {
    type: "array",
    toneType: "symbol",
    surname: surname ? "head" : "off",
  });
  // pinyin-pro echoes back characters it can't read; those become "".
  return result.length === chars.length
    ? result.map((s, i) => (s === chars[i] ? "" : s))
    : chars.map((char) => {
        const s = pinyin(char, { toneType: "symbol" });
        return s === char ? "" : s;
      });
}

function surnameFirstRun(pinyin: PinyinFn, run: string): string[] {
  const parts = syllables(pinyin, run, { surname: true });
  const surname = COMPOUND_SURNAMES.has(Array.from(run).slice(0, 2).join("")) ? 2 : 1;
  return parts.map((s, i) => (i === 0 || i === surname ? capitalize(s) : s));
}

export type Person = { full: string | null; first: string | null; last: string | null };

const singleHanRun = (text: string | null): text is string => {
  if (!text) return false;
  const runs = hanRuns(text);
  return runs.length === 1 && runs[0].han;
};

const hanTexts = (text: string | null) =>
  hanRuns(text ?? "").filter((run) => run.han).map((run) => run.text);

function add(readings: Readings, run: string, value: string[]) {
  if (lookupRun(readings, run) === null) readings[run] = value;
}

function addPerson(pinyin: PinyinFn, readings: Readings, person: Person) {
  if (singleHanRun(person.first) && singleHanRun(person.last)) {
    const lastLength = Array.from(person.last).length;
    // One call over last+first: generated apart, the surname loses its reading (单 shàn).
    const parts = syllables(pinyin, person.last + person.first, { surname: true });
    add(readings, person.last, word(parts.slice(0, lastLength)));
    add(readings, person.first, word(parts.slice(lastLength)));
  } else if (person.first !== null || person.last !== null) {
    for (const run of hanTexts(person.last)) {
      add(readings, run, word(syllables(pinyin, run, { surname: true })));
    }
    for (const run of hanTexts(person.first)) {
      add(readings, run, word(syllables(pinyin, run, { surname: false })));
    }
  }
  const runs = hanTexts(person.full);
  if (runs.length === 1) {
    add(readings, runs[0], surnameFirstRun(pinyin, runs[0]));
    return;
  }
  // Stored names put the given name first ("华 李"): only the last run is the surname.
  runs.forEach((run, i) => {
    add(readings, run, word(syllables(pinyin, run, { surname: i === runs.length - 1 })));
  });
}

const personHasHan = (person: Person) =>
  hasHan(person.full) || hasHan(person.first) || hasHan(person.last);

/**
 * Returns {} when pinyin-pro can't load: never throw, or the dashboard fails
 * for any book with a Chinese name.
 */
export async function contactReadings({ people }: { people: readonly Person[] }): Promise<Readings> {
  if (!people.some(personHasHan)) return {};
  let pinyin: PinyinFn;
  try {
    pinyin = await loadPinyin();
  } catch (err) {
    console.error(`[py] [contactReadings] pinyin-pro failed to load: ${err instanceof Error ? err.name : typeof err}`);
    return {};
  }
  const readings: Readings = {};
  for (const person of people) addPerson(pinyin, readings, person);
  return readings;
}

type ContactNames = {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  partnerName: string | null;
  partnerFirstName: string | null;
  partnerLastName: string | null;
};

export function readingsForContact(
  contact: ContactNames,
  { extra = [] }: { extra?: readonly Person[] } = {},
): Promise<Readings> {
  return contactReadings({
    people: [
      { full: contact.fullName, first: contact.firstName, last: contact.lastName },
      { full: contact.partnerName, first: contact.partnerFirstName, last: contact.partnerLastName },
      ...extra,
    ],
  });
}
