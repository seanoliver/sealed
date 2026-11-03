import { describe, expect, it } from "vitest";
import { lookupUsZip, zipMismatch } from "./us-zip";

describe("lookupUsZip", () => {
  it("finds the city and state for a ZIP", () => {
    expect(lookupUsZip("94112")).toEqual({ state: "CA", city: "San Francisco" });
    expect(lookupUsZip(" 97214-1234 ")).toEqual({ state: "OR", city: "Portland" });
  });
  it("returns null for an unknown or malformed ZIP", () => {
    expect(lookupUsZip("00000")).toBeNull();
    expect(lookupUsZip("abc")).toBeNull();
  });
});

describe("zipMismatch", () => {
  it("is quiet when city and state agree, ignoring case and punctuation", () => {
    expect(zipMismatch("94112", { city: "san francisco", state: "ca" })).toBeNull();
  });
  it("is quiet when the fields are still empty", () => {
    expect(zipMismatch("94112", { city: "", state: "" })).toBeNull();
  });
  it("suggests the ZIP's place when the city disagrees", () => {
    expect(zipMismatch("94112", { city: "Portland", state: "OR" })).toEqual({
      state: "CA",
      city: "San Francisco",
    });
  });
  it("says nothing for a ZIP it does not know", () => {
    expect(zipMismatch("00000", { city: "Anywhere", state: "ZZ" })).toBeNull();
  });
});
