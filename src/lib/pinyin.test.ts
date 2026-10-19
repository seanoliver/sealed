import { describe, expect, it } from "vitest";
import { contactReadings, generatedReadings, readingsForContact } from "./pinyin";
import { nameSegments, readingText } from "./readings";

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

describe("contactReadings", () => {
  it("reads surnames in surname mode", () => {
    expect(readingsForContact(contact)).toEqual({ 曾雨桐: ["Zēng", "Yǔ", "tóng"] });
    expect(readingsForContact({ ...contact, fullName: "单丽" })).toEqual({ 单丽: ["Shàn", "Lì"] });
  });

  it("capitalizes a compound surname as one word", () => {
    const readings = readingsForContact({ ...contact, fullName: "欧阳娜娜" });
    expect(readingText("欧阳娜娜", readings)).toBe("Ōuyáng Nànà");
  });

  it("reads split names in Chinese order", () => {
    const readings = readingsForContact({
      ...contact,
      fullName: "雨桐 曾",
      firstName: "雨桐",
      lastName: "曾",
    });
    expect(readings).toMatchObject({ 曾: ["Zēng"], 雨桐: ["Yǔ", "tóng"] });
    expect(readingText("雨桐 曾", readings)).toBe("Yǔtóng Zēng");
  });

  it("lets the override win over generated pinyin", () => {
    const readings = readingsForContact({ ...contact, nameReading: "Céng Yǔtóng" });
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
    expect(generatedReadings({ ...contact, nameReading: "Céng Yǔtóng" })).toEqual({
      曾雨桐: ["Zēng", "Yǔ", "tóng"],
    });
  });

  it("covers the partner and extra names, and nothing for Latin names", () => {
    const readings = readingsForContact(
      { ...contact, fullName: "Tom Reyes", partnerName: "李娜" },
      { extra: ["王芳"] },
    );
    expect(readings).toEqual({ 李娜: ["Lǐ", "Nà"], 王芳: ["Wáng", "Fāng"] });
    expect(
      contactReadings({ people: [{ full: "Ada", first: null, last: null, override: null }] }),
    ).toEqual({});
  });

  it("leaves a character pinyin-pro can't read without a syllable", () => {
    expect(readingsForContact({ ...contact, fullName: "𠮷田" })).toEqual({ 𠮷田: ["", "Tián"] });
  });
});
