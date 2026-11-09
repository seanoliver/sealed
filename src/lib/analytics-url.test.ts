import { describe, expect, it } from "vitest";
import { redactAnalyticsUrl } from "./analytics-url";

describe("redactAnalyticsUrl", () => {
  it("replaces the recipient token in the path", () => {
    expect(redactAnalyticsUrl("https://sealed.page/u/abc123secret/confirm")).toBe(
      "https://sealed.page/u/[token]/confirm",
    );
    expect(redactAnalyticsUrl("https://sealed.page/u/abc123secret")).toBe(
      "https://sealed.page/u/[token]",
    );
  });

  it("drops query strings such as sign-in token hashes", () => {
    expect(
      redactAnalyticsUrl("https://sealed.page/auth/confirm?flow=login&token_hash=pkce_x&type=email"),
    ).toBe("https://sealed.page/auth/confirm");
  });

  it("leaves other paths alone", () => {
    expect(redactAnalyticsUrl("https://sealed.page/dashboard/contacts/1#top")).toBe(
      "https://sealed.page/dashboard/contacts/1",
    );
    expect(redactAnalyticsUrl("https://sealed.page/u/thanks")).toBe("https://sealed.page/u/thanks");
  });

  it("redacts a token that only starts with \"thanks\"", () => {
    expect(redactAnalyticsUrl("https://sealed.page/u/thanksQ9xabc/confirm")).toBe(
      "https://sealed.page/u/[token]/confirm",
    );
  });

  it.each([
    "https://sealed.page/u/abc123/confirm/x",
    "https://sealed.page/u/abc123/zzz",
    "https://sealed.page/U/abc123",
    "https://sealed.page//u/abc123",
    "https://sealed.page/u/thanks/abc123",
  ])("returns null for %s, which is not a recipient route", (raw) => {
    expect(redactAnalyticsUrl(raw)).toBeNull();
  });
});
