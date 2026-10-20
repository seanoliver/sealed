import { describe, expect, it } from "vitest";
import { contactReadings, readingsForContact } from "./pinyin";
import { matchesReading } from "./readings";

const contact = {
  fullName: "曾雨桐",
  firstName: null,
  lastName: null,
  partnerName: null,
  partnerFirstName: null,
  partnerLastName: null,
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
    expect(await readingsForContact({ ...contact, fullName: "欧阳娜娜" })).toEqual({
      欧阳娜娜: ["Ōu", "yáng", "Nà", "nà"],
    });
  });

  it("reads split names in Chinese order", async () => {
    const readings = await readingsForContact({
      ...contact,
      fullName: "雨桐 曾",
      firstName: "雨桐",
      lastName: "曾",
    });
    expect(readings).toMatchObject({ 曾: ["Zēng"], 雨桐: ["Yǔ", "tóng"] });
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

  it("finds names by pinyin in either order", async () => {
    const hua = await contactReadings({ people: [unsplit("华 李")] });
    const wei = await contactReadings({ people: [unsplit("张伟")] });
    for (const query of ["li hua", "hua li"]) {
      expect(matchesReading({ names: ["华 李"], readings: hua, query })).toBe(true);
    }
    for (const query of ["zhang wei", "wei zhang"]) {
      expect(matchesReading({ names: ["张伟"], readings: wei, query })).toBe(true);
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
