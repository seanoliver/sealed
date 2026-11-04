import { describe, expect, it } from "vitest";
import { lookupZip } from "./zip-action";

describe("lookupZip", () => {
  it("answers a well-formed US ZIP", async () => {
    expect(await lookupZip("94112")).toEqual({ state: "CA", city: "San Francisco" });
    expect(await lookupZip("97214-1234")).toEqual({ state: "OR", city: "Portland" });
  });
  it("refuses anything else without looking it up", async () => {
    for (const bad of ["abc", "1234", "941123", "", undefined as unknown as string]) {
      expect(await lookupZip(bad)).toBeNull();
    }
  });
});
