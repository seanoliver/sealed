import { describe, expect, it } from "vitest";
import { isRemovable } from "./envelope-names";

describe("isRemovable", () => {
  it("lets the owner remove anyone but the first person", () => {
    expect(isRemovable({ kind: "primary" }, "owner")).toBe(false);
    expect(isRemovable({ kind: "partner" }, "owner")).toBe(true);
    expect(isRemovable({ kind: "kid", index: 0 }, "owner")).toBe(true);
  });

  it("never lets the recipient page remove the first person", () => {
    expect(isRemovable({ kind: "primary" }, "primary")).toBe(false);
    expect(isRemovable({ kind: "primary" }, "partner")).toBe(false);
  });
  it("lets only the first person's link remove the partner", () => {
    expect(isRemovable({ kind: "partner" }, "primary")).toBe(true);
    expect(isRemovable({ kind: "partner" }, "partner")).toBe(false);
  });
  it("lets either link remove a kid", () => {
    expect(isRemovable({ kind: "kid", index: 0 }, "primary")).toBe(true);
    expect(isRemovable({ kind: "kid", index: 0 }, "partner")).toBe(true);
  });
});
