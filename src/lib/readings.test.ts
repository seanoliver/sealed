import { describe, expect, it } from "vitest";
import {
  hanRuns,
  hasHan,
  isPinyinQuery,
  lookupRun,
  matchesReading,
  nameSegments,
  pinyinKey,
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

describe("lookupRun and nameSegments", () => {
  const readings = { 张伟: ["Zhāng", "Wěi"], 李娜: ["Lǐ", "Nà"] };

  it("finds a run inside a per-character entry", () => {
    expect(lookupRun(readings, "伟")).toEqual(["Wěi"]);
    expect(lookupRun(readings, "王")).toBeNull();
  });

  it("puts a syllable over each character and passes other text through", () => {
    expect(nameSegments("张伟 & 李娜 & Tom", readings)).toEqual([
      { kind: "ruby", parts: [{ base: "张", rt: "Zhāng" }, { base: "伟", rt: "Wěi" }] },
      { kind: "text", text: " & " },
      { kind: "ruby", parts: [{ base: "李", rt: "Lǐ" }, { base: "娜", rt: "Nà" }] },
      { kind: "text", text: " & Tom" },
    ]);
  });

  it("leaves an unknown run as text", () => {
    expect(nameSegments("王芳", readings)).toEqual([{ kind: "text", text: "王芳" }]);
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

  it("matches a surname-first name given name first", () => {
    expect(matchesReading({ names, readings, query: "wei zhang" })).toBe(true);
    const zeng = { 曾雨桐: ["Zēng", "Yǔ", "tóng"] };
    expect(matchesReading({ names: ["曾雨桐"], readings: zeng, query: "yutong zeng" })).toBe(true);
    expect(matchesReading({ names: ["曾雨桐"], readings: zeng, query: "tong zeng yu" })).toBe(false);
  });

  it("matches a given-name-first name surname first", () => {
    const readings = { 华: ["Huá"], 李: ["Lǐ"] };
    for (const query of ["hua li", "li hua"]) {
      expect(matchesReading({ names: ["华 李"], readings, query })).toBe(true);
    }
  });

  it("ignores queries that aren't pinyin", () => {
    expect(isPinyinQuery("张")).toBe(false);
    expect(isPinyinQuery("a@b.com")).toBe(false);
    expect(matchesReading({ names, readings, query: "张" })).toBe(false);
  });
});
