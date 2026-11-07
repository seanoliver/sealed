import { describe, expect, it } from "vitest";
import {
  compareHouseholds,
  duplicateRows,
  detectDuplicates,
  MAX_PAIRS,
  MAX_SHARED_FIRST,
  matchInBook,
  parseBook,
  sameSlots,
  type MatchableNames,
} from "./household-match";

const legacy = (fullName: string, partnerName: string | null = null): MatchableNames => ({
  fullName,
  partnerName,
  firstName: null,
  lastName: null,
  partnerFirstName: null,
  partnerLastName: null,
});

const split = (
  first: string,
  last: string | null,
  partnerFirst: string | null = null,
  partnerLast: string | null = null,
): MatchableNames => ({
  fullName: [first, last].filter(Boolean).join(" "),
  partnerName: partnerFirst ? [partnerFirst, partnerLast].filter(Boolean).join(" ") : null,
  firstName: first,
  lastName: last,
  partnerFirstName: partnerFirst,
  partnerLastName: partnerLast,
});

describe("compareHouseholds", () => {
  it("treats the same couple in either order as the same people", () => {
    expect(
      compareHouseholds(split("Theo", "Marsh", "Nina", "Marsh"), split("Nina", "Marsh", "Theo", "Marsh")),
    ).toBe("same_people");
  });

  it("matches first-name-only couples in either order", () => {
    expect(compareHouseholds(legacy("Theo", "Nina"), legacy("Nina", "Theo"))).toBe("same_people");
  });

  it("matches a legacy row against a structured row", () => {
    expect(
      compareHouseholds(legacy("Nina Marsh", "Theo Marsh"), split("Theo", "Marsh", "Nina", "Marsh")),
    ).toBe("same_people");
  });

  it("gives a partner with no last name the household's last name", () => {
    expect(compareHouseholds(legacy("Theo Marsh", "Nina"), legacy("Nina Marsh", "Theo"))).toBe(
      "same_people",
    );
  });

  it("reads a couple typed into the name field with no partner column", () => {
    expect(compareHouseholds(legacy("Theo & Nina Marsh"), split("Nina", "Marsh", "Theo", "Marsh"))).toBe(
      "same_people",
    );
    expect(compareHouseholds(legacy("Theo and Nina Marsh"), legacy("Nina Marsh & Theo Marsh"))).toBe(
      "same_people",
    );
  });

  it("matches no-partner rows on the one person", () => {
    expect(compareHouseholds(legacy("Ana Ruiz"), split("Ana", "Ruiz"))).toBe("same_people");
  });

  it("flags a solo row that is one half of a couple as sharing a person", () => {
    expect(compareHouseholds(legacy("Theo Marsh"), split("Nina", "Marsh", "Theo", "Marsh"))).toBe(
      "shares_person",
    );
  });

  it("flags two couples with one person in common as sharing a person", () => {
    expect(
      compareHouseholds(split("Theo", "Marsh", "Nina", "Marsh"), split("Theo", "Marsh", "Mary", "Smith")),
    ).toBe("shares_person");
  });

  it("lets a missing last name match a present one", () => {
    expect(compareHouseholds(legacy("Theo", "Nina"), split("Theo", "Marsh", "Nina", "Marsh"))).toBe(
      "same_people",
    );
  });

  it("does not match different last names", () => {
    expect(compareHouseholds(legacy("Theo Marsh"), legacy("Theo Smith"))).toBeNull();
  });

  it("does not match a couple on a shared last name alone", () => {
    expect(
      compareHouseholds(split("Theo", "Marsh", "Nina", "Marsh"), split("Ben", "Marsh", "Kim", "Marsh")),
    ).toBeNull();
  });

  it("ignores case, accents, punctuation and spacing", () => {
    expect(compareHouseholds(legacy("  josé  O'BRIEN "), legacy("Jose OBrien"))).toBe("same_people");
    expect(compareHouseholds(legacy("Mary-Jane Watson"), legacy("mary jane watson"))).toBe("same_people");
  });

  it("does not care where a multi-word name was split", () => {
    expect(compareHouseholds(split("Mary Jane", "Watson"), split("Mary", "Jane Watson"))).toBe("same_people");
  });

  it("keeps a household label whole", () => {
    expect(compareHouseholds(legacy("Satya & Family"), legacy("satya & family"))).toBe("same_people");
    expect(compareHouseholds(legacy("Satya & Family"), legacy("Satya Nadella"))).toBeNull();
    expect(compareHouseholds(legacy("The Smiths"), legacy("The Joneses"))).toBeNull();
  });

  it("matches names in Chinese characters exactly", () => {
    expect(compareHouseholds(legacy("李明", "王芳"), legacy("王芳", "李明"))).toBe("same_people");
  });

  it("never matches a name with no letters in it", () => {
    expect(compareHouseholds(legacy("???"), legacy("!!!"))).toBeNull();
  });
});

describe("detectDuplicates", () => {
  const book = [
    { id: "a", ...legacy("Theo", "Nina") },
    { id: "b", ...legacy("Nina", "Theo") },
    { id: "c", ...legacy("Ana Ruiz") },
    { id: "d", ...legacy("Theo") },
  ];

  it("returns each pair once, ordered by id, strongest first", () => {
    expect(detectDuplicates(book)).toEqual([
      { a: "a", b: "b", match: "same_people" },
      { a: "a", b: "d", match: "shares_person" },
      { a: "b", b: "d", match: "shares_person" },
    ]);
  });

  it("leaves out pairs the owner already dismissed", () => {
    expect(detectDuplicates(book, { dismissed: [{ a: "a", b: "d" }, { a: "b", b: "d" }] })).toEqual([
      { a: "a", b: "b", match: "same_people" },
    ]);
  });

  it("orders pairs by id whatever order the book came in", () => {
    expect(detectDuplicates([book[1], book[0]])).toEqual([{ a: "a", b: "b", match: "same_people" }]);
  });
});

describe("detectDuplicates at scale", () => {
  it("stops at the pair cap when many contacts hold the same people", () => {
    const book = Array.from({ length: 200 }, (_, i) => ({ id: `id${String(i).padStart(4, "0")}`, ...legacy("Ana Ruiz") }));
    expect(findCount(book)).toBe(MAX_PAIRS);
  });

  it("skips a first word shared by too many contacts to compare", () => {
    const book = Array.from({ length: MAX_SHARED_FIRST + 1 }, (_, i) => ({
      id: `id${String(i).padStart(4, "0")}`,
      ...legacy(`Mr Person${i}`),
    }));
    book.push({ id: "zz", ...legacy("Mr Person0") });
    expect(findCount(book)).toBe(0);
  });
});

const findCount = (book: Parameters<typeof detectDuplicates>[0]) => detectDuplicates(book).length;

describe("matchInBook", () => {
  it("finds the contacts a new household matches, strongest first", () => {
    const book = [
      { id: "solo", ...legacy("Theo Marsh") },
      { id: "couple", ...split("Nina", "Marsh", "Theo", "Marsh") },
      { id: "other", ...legacy("Ana Ruiz") },
    ];
    expect(matchInBook(split("Theo", "Marsh", "Nina", "Marsh"), parseBook(book))).toEqual([
      { id: "couple", match: "same_people" },
      { id: "solo", match: "shares_person" },
    ]);
  });
});

describe("duplicateRows", () => {
  it("finds rows already in the book and repeats within the file", () => {
    const book = [{ id: "x", ...legacy("Theo Marsh", "Nina Marsh") }];
    const rows = [legacy("Nina Marsh", "Theo Marsh"), legacy("Ana Ruiz"), legacy("ana ruiz"), legacy("Ben Park")];
    expect(duplicateRows(rows, book)).toEqual([0, 2]);
  });
});

describe("sameSlots", () => {
  const couple = legacy("Theo Marsh", "Nina Marsh");

  it("accepts the same person, with or without their partner", () => {
    expect(sameSlots(couple, legacy("Theo Marsh"))).toBe(true);
    expect(sameSlots(couple, legacy("Theo Marsh", "Nina Marsh"))).toBe(true);
  });

  it("refuses a partner replying alone, or a swapped reply", () => {
    expect(sameSlots(couple, legacy("Nina Marsh"))).toBe(false);
    expect(sameSlots(couple, legacy("Nina Marsh", "Theo Marsh"))).toBe(false);
  });

  it("refuses a reply naming a different partner", () => {
    expect(sameSlots(couple, legacy("Theo Marsh", "Mary Smith"))).toBe(false);
  });
});
