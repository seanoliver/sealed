import { describe, expect, it } from "vitest";
import { parseEmailField } from "./email";

function form(email?: string): FormData {
  const data = new FormData();
  if (email !== undefined) data.set("email", email);
  return data;
}

describe("parseEmailField", () => {
  it("returns the trimmed email, keeping its case", () => {
    expect(parseEmailField(form("  A@Example.test "))).toBe("A@Example.test");
  });

  it.each([
    ["missing", undefined],
    ["blank", "  "],
    ["invalid", "not-an-email"],
    ["too long", `${"a".repeat(250)}@x.io`],
  ])("returns null when %s", (_label, value) => {
    expect(parseEmailField(form(value))).toBeNull();
  });
});
