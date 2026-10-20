import { describe, expect, it } from "vitest";
import { contactReadings, generatedReadings, readingsForContact } from "./pinyin";
import { matchesReading, nameSegments, readingText } from "./readings";

const contact = {
  fullName: "曾雨桐",
  firstName: null,
  lastName: null,
  partnerName: null,
  partnerFirstName: null,
  partnerLastName: null,
  nameReading: null,
  partnerNameReading: null,
};

const unsplit = (full: string) => ({ full, first: null, last: null });

describe("contactReadings", () => {
  it("reads surnames in surname mode", async () => {
    expect(await readingsForContact(contact)).toEqual({ 曾雨桐: ["Zēng", "Yǔ", "tóng"] });
    expect(await readingsForContact({ ...contact, fullName: "单丽" })).toEqual({
      单丽: ["Shàn", "Lì"],
    });
  });

  it("capitalizes a compound surname as one word", async () => {
    const readings = await readingsForContact({ ...contact, fullName: "欧阳娜娜" });
    expect(readingText("欧阳娜娜", readings)).toBe("Ōuyáng Nànà");
  });

  it("reads split names in Chinese order", async () => {
    const readings = await readingsForContact({
      ...contact,
      fullName: "雨桐 曾",
      firstName: "雨桐",
      lastName: "曾",
    });
    expect(readings).toMatchObject({ 曾: ["Zēng"], 雨桐: ["Yǔ", "tóng"] });
    expect(readingText("雨桐 曾", readings)).toBe("Yǔtóng Zēng");
  });

  it("reads only the last run of an unsplit given-name-first name as a surname", async () => {
    for (const [full, expected] of [
      ["华 李", { 华: ["Huá"], 李: ["Lǐ"] }],
      ["乐乐 王", { 乐乐: ["Lè", "lè"], 王: ["Wáng"] }],
      ["单丹 李", { 单丹: ["Dān", "dān"], 李: ["Lǐ"] }],
    ] as const) {
      expect(await contactReadings({ people: [unsplit(full)] })).toEqual(expected);
    }
  });

  it("reads a given name on its own without surname readings", async () => {
    expect(
      await contactReadings({ people: [{ full: "乐乐 Wang", first: "乐乐", last: "Wang" }] }),
    ).toEqual({ 乐乐: ["Lè", "lè"] });
  });

  it("reads submitted people by their first and last names", async () => {
    const readings = await readingsForContact(
      { ...contact, fullName: "Tom Reyes" },
      { extra: [{ full: "华 李", first: "华", last: "李" }] },
    );
    expect(readings).toEqual({ 李: ["Lǐ"], 华: ["Huá"] });
  });

  it("lets the override win over generated pinyin", async () => {
    const readings = await readingsForContact({ ...contact, nameReading: "Céng Yǔtóng" });
    expect(nameSegments("曾雨桐", readings)).toEqual([
      {
        kind: "ruby",
        parts: [
          { base: "曾", rt: "Céng" },
          { base: "雨", rt: "Yǔ" },
          { base: "桐", rt: "tóng" },
        ],
      },
    ]);
    expect(await generatedReadings({ ...contact, nameReading: "Céng Yǔtóng" })).toEqual({
      曾雨桐: ["Zēng", "Yǔ", "tóng"],
    });
  });

  it("places a surname-first override on a given-name-first name", async () => {
    const stored = { ...contact, fullName: "雨桐 曾", firstName: "雨桐", lastName: "曾" };
    const readings = await readingsForContact({ ...stored, nameReading: "Zēng Yǔtóng" });
    expect(readings).toMatchObject({ 曾: ["Zēng"], 雨桐: ["Yǔ", "tóng"] });
    const asTyped = await readingsForContact({ ...stored, nameReading: "Yǔtóng Céng" });
    expect(asTyped).toMatchObject({ 曾: ["Céng"], 雨桐: ["Yǔ", "tóng"] });
  });

  it("finds a given-name-first name by pinyin in either order", async () => {
    const readings = await contactReadings({ people: [unsplit("华 李")] });
    for (const query of ["li hua", "hua li"]) {
      expect(matchesReading({ names: ["华 李"], readings, query })).toBe(true);
    }
  });

  it("covers the partner and nothing for Latin names", async () => {
    const readings = await readingsForContact({
      ...contact,
      fullName: "Tom Reyes",
      partnerName: "李娜",
    });
    expect(readings).toEqual({ 李娜: ["Lǐ", "Nà"] });
    expect(await contactReadings({ people: [unsplit("Ada")] })).toEqual({});
  });

  it("leaves a character pinyin-pro can't read without a syllable", async () => {
    expect(await readingsForContact({ ...contact, fullName: "𠮷田" })).toEqual({
      𠮷田: ["", "Tián"],
    });
  });
});
