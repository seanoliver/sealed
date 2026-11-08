import { describe, expect, it } from "vitest";
import { isWorkEmail } from "./email-kind";

describe("isWorkEmail", () => {
  it("treats an address outside the consumer list as work", () => {
    expect(isWorkEmail("dana@acme.co")).toBe(true);
    expect(isWorkEmail("dana@stanford.edu")).toBe(true);
  });

  it("recognizes webmail, ISP and international consumer domains", () => {
    for (const email of [
      "a@gmail.com",
      "a@comcast.net",
      "a@sbcglobal.net",
      "a@qq.com",
      "a@163.com",
      "a@naver.com",
      "a@gmx.de",
      "a@web.de",
      "a@yahoo.co.uk",
      "a@icloud.com",
      "a@pm.me",
      "a@hey.com",
      "a@fastmail.com",
    ]) {
      expect(isWorkEmail(email), email).toBe(false);
    }
  });

  it("ignores case and surrounding space", () => {
    expect(isWorkEmail("  A@GMail.COM ")).toBe(false);
    expect(isWorkEmail("A@ACME.CO")).toBe(true);
  });

  it("lets the owner's override win in both directions", () => {
    expect(isWorkEmail("me@seanoliver.com", { kind: "personal" })).toBe(false);
    expect(isWorkEmail("side-gig@gmail.com", { kind: "work" })).toBe(true);
    expect(isWorkEmail("dana@acme.co", { kind: null })).toBe(true);
  });

  it("is false for a missing or malformed address, even with an override", () => {
    for (const email of [null, undefined, "", "acme.co", "@acme.co", "a@", "a@b@acme.co"]) {
      expect(isWorkEmail(email), String(email)).toBe(false);
      expect(isWorkEmail(email, { kind: "work" }), String(email)).toBe(false);
    }
  });
});
