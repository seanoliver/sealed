import { describe, expect, it } from "vitest";
import type { UserIdentity } from "@supabase/supabase-js";
import { authDisplayName, suggestLinkName } from "./onboarding";

describe("suggestLinkName", () => {
  it.each([
    ["Sean.Oliver@example.com", "sean-oliver"],
    ["sean+holiday@example.com", "sean"],
    ["family_cards@example.com", "family-cards"],
    ["dots...and___spaces@example.com", "dots-and-spaces"],
  ])("suggests a public link for %s", (email, expected) => {
    expect(suggestLinkName(email)).toBe(expected);
  });

  it.each([
    "x@example.com",
    "++@example.com",
    "",
    `${"a".repeat(64)}@example.com`,
  ])("uses the fallback when %j cannot produce a valid link", (email) => {
    expect(suggestLinkName(email)).toBe("my-address-book");
  });
});

describe("authDisplayName", () => {
  const identity = (provider: string, identity_data: Record<string, unknown>): UserIdentity => ({
    id: provider,
    user_id: "u1",
    identity_id: provider,
    provider,
    identity_data,
  });

  it("uses the full name on a linked Google identity", () => {
    expect(
      authDisplayName([identity("email", {}), identity("google", { full_name: "  Ada Lovelace  " })]),
    ).toBe("Ada Lovelace");
  });

  it("prefers full_name over name", () => {
    expect(authDisplayName([identity("google", { full_name: "Full", name: "Short" })])).toBe("Full");
  });

  it("accepts Google's name field when full_name is absent", () => {
    expect(authDisplayName([identity("google", { name: "Grace" })])).toBe("Grace");
  });

  it("ignores names from any other identity", () => {
    expect(authDisplayName([identity("email", { full_name: "Chosen Name" })])).toBe("");
    expect(authDisplayName(undefined)).toBe("");
  });

  it("ignores malformed or empty identity data", () => {
    expect(authDisplayName([identity("google", { full_name: "  ", name: 42 })])).toBe("");
  });
});
