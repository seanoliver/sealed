import { describe, expect, it } from "vitest";
import {
  hanRuns,
  hasHan,
  isPinyinQuery,
  lookupRun,
  matchesReading,
  nameSegments,
  overrideReadings,
  pinyinKey,
  readingText,
  splitReading,
} from "./readings";

describe("hanRuns", () => {
  it("splits Han runs from the text around them", () => {
    expect(hanRuns("张伟 & Tom Reyes")).toEqual([
      { text: "张伟", han: true },
      { text: " & Tom Reyes", han: false },
    ]);
    expect(hanRuns("单丽 & 李娜")).toEqual([
      { text: "单丽", han: true },
      { text: " & ", han: false },
      { text: "李娜", han: true },
    ]);
  });

  it("leaves Latin text alone", () => {
    expect(hanRuns("Ada Lovelace")).toEqual([{ text: "Ada Lovelace", han: false }]);
    expect(hasHan("Ada Lovelace")).toBe(false);
    expect(hasHan(null)).toBe(false);
  });

  it("keeps characters outside the BMP whole", () => {
    expect(hanRuns("𠮷田")).toEqual([{ text: "𠮷田", han: true }]);
  });
});

describe("splitReading", () => {
  it("splits joined syllables and keeps tones and capitals", () => {
    expect(splitReading("Céng Yǔtóng", 3)).toEqual(["Céng", "Yǔ", "tóng"]);
    expect(splitReading("Zhāng Wěi", 2)).toEqual(["Zhāng", "Wěi"]);
    expect(splitReading("Ōuyáng Nàna", 4)).toEqual(["Ōu", "yáng", "Nà", "na"]);
  });

  it("splits an ambiguous run to the count it needs", () => {
    expect(splitReading("xian", 1)).toEqual(["xian"]);
    expect(splitReading("xian", 2)).toEqual(["xi", "an"]);
  });

  it("accepts tone numbers, ü and v", () => {
    expect(splitReading("lv3 nü", 2)).toEqual(["lv3", "nü"]);
  });

  it("returns null when the count can't match", () => {
    expect(splitReading("Zhāng Wěi", 3)).toBeNull();
    expect(splitReading("Bob", 1)).toBeNull();
    expect(splitReading("", 1)).toBeNull();
  });

  it("stays fast on long input", () => {
    expect(splitReading("a".repeat(200), 3)).toBeNull();
  });
});

describe("overrideReadings", () => {
  it("places one syllable on each character", () => {
    expect(overrideReadings({ name: "曾雨桐", reading: "Céng Yǔtóng" })).toEqual({
      曾雨桐: ["Céng", "Yǔ", "tóng"],
    });
  });

  it("spreads syllables across runs in order", () => {
    expect(overrideReadings({ name: "伟 张", reading: "Wěi Zhāng" })).toEqual({
      伟: ["Wěi"],
      张: ["Zhāng"],
    });
  });

  it("takes a surname-first reading in reverse when that matches the generated one", () => {
    const generated = { 曾: ["Zēng"], 雨桐: ["Yǔ", "tóng"] };
    expect(overrideReadings({ name: "雨桐 曾", reading: "Zēng Yǔtóng", generated })).toEqual({
      曾: ["Zēng"],
      雨桐: ["Yǔ", "tóng"],
    });
    expect(overrideReadings({ name: "雨桐 曾", reading: "Yǔtóng Céng", generated })).toEqual({
      雨桐: ["Yǔ", "tóng"],
      曾: ["Céng"],
    });
  });

  it("keeps display order when nothing tells the orders apart", () => {
    expect(overrideReadings({ name: "雨桐 曾", reading: "Zēng Yǔtóng" })).toEqual({
      雨桐: ["Zēng", "Yǔ"],
      曾: ["tóng"],
    });
  });

  it("falls back to one reading over the whole run when the count differs", () => {
    expect(overrideReadings({ name: "张伟", reading: "Jang Way Jr" })).toEqual({
      张伟: ["Jang Way Jr"],
    });
  });

  it("ignores an empty override or a name without Han", () => {
    expect(overrideReadings({ name: "张伟", reading: "  " })).toEqual({});
    expect(overrideReadings({ name: "Ada", reading: "ah-da" })).toEqual({});
  });
});

describe("lookupRun and nameSegments", () => {
  const readings = { 张伟: ["Zhāng", "Wěi"], 李娜: ["Lǐ Nuo"] };

  it("finds a run inside a per-character entry", () => {
    expect(lookupRun(readings, "伟")).toEqual(["Wěi"]);
    expect(lookupRun(readings, "李")).toBeNull();
  });

  it("puts a syllable over each character and passes other text through", () => {
    expect(nameSegments("张伟 & 李娜 & Tom", readings)).toEqual([
      { kind: "ruby", parts: [{ base: "张", rt: "Zhāng" }, { base: "伟", rt: "Wěi" }] },
      { kind: "text", text: " & " },
      { kind: "ruby", parts: [{ base: "李娜", rt: "Lǐ Nuo" }] },
      { kind: "text", text: " & Tom" },
    ]);
  });

  it("leaves an unknown run as text", () => {
    expect(nameSegments("王芳", readings)).toEqual([{ kind: "text", text: "王芳" }]);
  });
});

describe("readingText", () => {
  it("joins a given name and spaces at capitals", () => {
    expect(readingText("曾雨桐", { 曾雨桐: ["Zēng", "Yǔ", "tóng"] })).toBe("Zēng Yǔtóng");
    expect(readingText("Ada", {})).toBeNull();
  });
});

describe("pinyin search", () => {
  const readings = { 张伟: ["Zhāng", "Wěi"] };
  const names = ["张伟", null];

  it("folds tones, spaces and case", () => {
    expect(pinyinKey("Zhāng Wěi")).toBe("zhangwei");
    expect(pinyinKey("lǚ")).toBe("lu");
  });

  it("matches with or without tone marks", () => {
    for (const query of ["zhang wei", "zhāng", "ZHANGWEI", "wei"]) {
      expect(matchesReading({ names, readings, query })).toBe(true);
    }
    expect(matchesReading({ names, readings, query: "li na" })).toBe(false);
  });

  it("ignores queries that aren't pinyin", () => {
    expect(isPinyinQuery("张")).toBe(false);
    expect(isPinyinQuery("a@b.com")).toBe(false);
    expect(matchesReading({ names, readings, query: "张" })).toBe(false);
  });
});
