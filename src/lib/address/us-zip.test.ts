import { describe, expect, it } from "vitest";
import { lookupUsZip } from "./us-zip";

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
