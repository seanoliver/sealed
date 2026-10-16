import { describe, expect, it } from "vitest";
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
  const google = { app_metadata: { provider: "google" } };

  it.each([
    ["email", { app_metadata: { provider: "email" } }],
    ["missing", {}],
  ])("ignores metadata names when the provider is %s", (_label, app) => {
    expect(authDisplayName({ ...app, user_metadata: { full_name: "Chosen Name" } })).toBe("");
  });

  it("uses a genuine full name from identity-provider metadata", () => {
    expect(authDisplayName({ ...google, user_metadata: { full_name: "  Ada Lovelace  " } })).toBe(
      "Ada Lovelace",
    );
  });

  it("accepts the provider's name field when full_name is absent", () => {
    expect(authDisplayName({ ...google, user_metadata: { name: "Grace" } })).toBe("Grace");
  });

  it("does not guess a name from an email claim", () => {
    expect(authDisplayName({ ...google, email: "sean.oliver@example.com" })).toBe("");
  });

  it("ignores malformed or empty metadata", () => {
    expect(authDisplayName({ ...google, user_metadata: { full_name: "  ", name: 42 } })).toBe("");
  });
});
