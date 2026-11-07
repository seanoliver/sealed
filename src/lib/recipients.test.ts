import { describe, expect, it } from "vitest";
import { addressRecipients, inviteAddresses } from "./recipients";

const names = { firstName: "Ana", partnerFirstName: "Mark" };

describe("inviteAddresses", () => {
  it("prefers each person's personal email", () => {
    expect(
      inviteAddresses({
        email: "ana@acme.co",
        partnerEmail: "mark@globex.co",
        personalEmail: "ana@gmail.com",
        partnerPersonalEmail: "mark@gmail.com",
      }),
    ).toEqual({ primary: "ana@gmail.com", partner: "mark@gmail.com" });
  });

  it("falls back to the stored email, and handles a missing personal field", () => {
    expect(inviteAddresses({ email: "ana@acme.co", partnerEmail: null })).toEqual({
      primary: "ana@acme.co",
    });
  });

  it("works from a personal email alone", () => {
    expect(
      inviteAddresses({ email: null, partnerEmail: null, personalEmail: "ana@gmail.com" }),
    ).toEqual({ primary: "ana@gmail.com" });
  });

  it("sends a couple sharing one inbox a single email, to the primary", () => {
    expect(
      inviteAddresses({
        email: "ana@acme.co",
        partnerEmail: "mark@globex.co",
        personalEmail: "Family@Gmail.com",
        partnerPersonalEmail: "family@gmail.com",
      }),
    ).toEqual({ primary: "Family@Gmail.com" });
  });
});

describe("addressRecipients", () => {
  it("keeps each person's first name with the address to send to", () => {
    expect(
      addressRecipients({
        ...names,
        email: "ana@acme.co",
        partnerEmail: "mark@globex.co",
        personalEmail: "ana@gmail.com",
      }),
    ).toEqual([
      { recipient: "primary", email: "ana@gmail.com", firstName: "Ana" },
      { recipient: "partner", email: "mark@globex.co", firstName: "Mark" },
    ]);
  });
});
