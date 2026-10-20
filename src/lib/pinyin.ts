import "server-only";
import { pinyin } from "pinyin-pro";
import { hanRuns, lookupRun, overrideReadings, type Readings } from "@/lib/readings";

const COMPOUND_SURNAMES = new Set([
  "欧阳", "司马", "诸葛", "上官", "司徒", "东方", "皇甫", "尉迟", "公孙", "慕容",
  "令狐", "夏侯", "长孙", "宇文", "轩辕", "端木", "澹台", "呼延", "独孤", "南宫",
  "西门", "百里", "东郭", "闻人", "申屠", "太史", "万俟", "钟离", "濮阳", "淳于",
]);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function syllables(run: string): string[] {
  const chars = Array.from(run);
  const result = pinyin(run, { type: "array", toneType: "symbol", surname: "head" });
  // pinyin-pro echoes back characters it can't read; those become "".
  return result.length === chars.length
    ? result.map((s, i) => (s === chars[i] ? "" : s))
    : chars.map((char) => {
        const s = pinyin(char, { toneType: "symbol" });
        return s === char ? "" : s;
      });
}

function personSyllables(run: string): string[] {
  const parts = syllables(run);
  const surname = COMPOUND_SURNAMES.has(Array.from(run).slice(0, 2).join("")) ? 2 : 1;
  return parts.map((s, i) => (i === 0 || i === surname ? capitalize(s) : s));
}

type Person = {
  full: string | null;
  first: string | null;
  last: string | null;
  override: string | null;
};

const singleHanRun = (text: string | null): text is string => {
  if (!text) return false;
  const runs = hanRuns(text);
  return runs.length === 1 && runs[0].han;
};

function add(readings: Readings, run: string, value: string[]) {
  if (lookupRun(readings, run) === null) readings[run] = value;
}

function addPerson(readings: Readings, person: Person) {
  if (singleHanRun(person.first) && singleHanRun(person.last)) {
    const lastLength = Array.from(person.last).length;
    // One call over last+first: generated apart, the surname loses its reading (单 shàn).
    const parts = syllables(person.last + person.first);
    const word = (s: string[]) => s.map((x, i) => (i === 0 ? capitalize(x) : x));
    add(readings, person.last, word(parts.slice(0, lastLength)));
    add(readings, person.first, word(parts.slice(lastLength)));
  }
  for (const run of hanRuns(person.full ?? "")) {
    if (run.han) add(readings, run.text, personSyllables(run.text));
  }
}

export function contactReadings({
  people,
  extra = [],
}: {
  people: readonly Person[];
  extra?: readonly (string | null | undefined)[];
}): Readings {
  const readings: Readings = {};
  // Overrides first: add() never replaces a reading that is already there.
  for (const person of people) {
    Object.assign(readings, overrideReadings({ name: person.full, reading: person.override }));
  }
  for (const person of people) addPerson(readings, person);
  for (const text of extra) {
    if (text) addPerson(readings, { full: text, first: null, last: null, override: null });
  }
  return readings;
}

type ContactNames = {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  partnerName: string | null;
  partnerFirstName: string | null;
  partnerLastName: string | null;
  nameReading: string | null;
  partnerNameReading: string | null;
};

export function readingsForContact(
  contact: ContactNames,
  { extra = [] }: { extra?: readonly (string | null | undefined)[] } = {},
): Readings {
  return contactReadings({
    people: [
      {
        full: contact.fullName,
        first: contact.firstName,
        last: contact.lastName,
        override: contact.nameReading,
      },
      {
        full: contact.partnerName,
        first: contact.partnerFirstName,
        last: contact.partnerLastName,
        override: contact.partnerNameReading,
      },
    ],
    extra,
  });
}

export function generatedReadings(contact: ContactNames): Readings {
  return readingsForContact({ ...contact, nameReading: null, partnerNameReading: null });
}
