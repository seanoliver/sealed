import { describe, expect, it } from "vitest";
import { redactAnalyticsUrl } from "./analytics-url";

const TOKEN = "Abc123_-Xyz7890abcdefghijklmnopqrstuvwxyzAB";
const THANKS_TOKEN = "thanksQ9x" + TOKEN.slice(9);
const SITE = "https://sealed.page";

describe("redactAnalyticsUrl", () => {
  it("uses a real-shaped token in these tests", () => {
    expect(TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("replaces the recipient token on the recipient routes", () => {
    expect(redactAnalyticsUrl(`${SITE}/u/${TOKEN}/confirm`)).toBe(`${SITE}/u/[token]/confirm`);
    expect(redactAnalyticsUrl(`${SITE}/u/${TOKEN}`)).toBe(`${SITE}/u/[token]`);
    expect(redactAnalyticsUrl(`${SITE}/u/${THANKS_TOKEN}/confirm`)).toBe(`${SITE}/u/[token]/confirm`);
  });

  it("drops query strings such as sign-in token hashes", () => {
    expect(redactAnalyticsUrl(`${SITE}/auth/confirm?flow=login&token_hash=pkce_x&type=email`)).toBe(
      `${SITE}/auth/confirm`,
    );
  });

  it("leaves other paths alone", () => {
    expect(redactAnalyticsUrl(`${SITE}/dashboard/contacts/0637f441-7b28-4968-9272-9f0debb08487#top`)).toBe(
      `${SITE}/dashboard/contacts/0637f441-7b28-4968-9272-9f0debb08487`,
    );
    expect(redactAnalyticsUrl(`${SITE}/u/thanks`)).toBe(`${SITE}/u/thanks`);
    expect(redactAnalyticsUrl(`${SITE}/`)).toBe(`${SITE}/`);
  });

  it("keeps public book pages with long link names", () => {
    const slug43 = "sean-and-tina-oliver-family-holiday-cards-1";
    const slug63 = "a".repeat(63);
    expect(slug43).toHaveLength(43);
    expect(redactAnalyticsUrl(`${SITE}/b/${slug43}`)).toBe(`${SITE}/b/${slug43}`);
    expect(redactAnalyticsUrl(`${SITE}/b/${slug63}/thanks`)).toBe(`${SITE}/b/${slug63}/thanks`);
  });

  it.each([
    ["an extra segment", `/u/${TOKEN}/confirm/x`],
    ["an unknown segment", `/u/${TOKEN}/zzz`],
    ["an uppercase prefix", `/U/${TOKEN}`],
    ["a doubled slash", `//u/${TOKEN}`],
    ["a path under thanks", `/u/thanks/${TOKEN}`],
    ["a trailing comma", `/u/${TOKEN},/confirm`],
    ["a trailing at sign", `/u/${TOKEN}@/confirm`],
    ["a trailing escape", `/u/${TOKEN}%3e/confirm`],
    ["an encoded prefix", `/%75/${TOKEN}`],
    ["an encoded slash", `/u%2F${TOKEN}`],
    ["a token without its prefix", `/${TOKEN}`],
    ["a token under another path", `/x/u/${TOKEN}`],
    ["a token as a book link", `/b/${TOKEN}`],
    ["a short token", "/u/abc123"],
    ["a token with an encoded character", `/x/${TOKEN.slice(0, 21)}%${TOKEN.charCodeAt(21).toString(16)}${TOKEN.slice(22)}`],
  ])("returns null for %s", (_, path) => {
    expect(redactAnalyticsUrl(`${SITE}${path}`)).toBeNull();
  });
});
