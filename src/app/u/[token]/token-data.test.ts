import { describe, expect, it } from "vitest";
import { recipientPrefill, type TokenData } from "./token-data";

const data = (enabled: TokenData["enabled_fields"]): TokenData => ({
  contact: {
    full_name: "Ana Reyes",
    partner_name: "Hidden Partner",
    kids_names: "Hidden Kid",
    first_name: "Ana",
    last_name: "Reyes",
    partner_first_name: "Hidden",
    partner_last_name: "Partner",
    kids: [{ first: "Hidden", last: "Kid" }],
    email: "ana@example.test",
    birthday: "1990-04-02",
    address_line1: "1 Main St",
    address_line2: null,
    district: null,
    city: "Portland",
    state_region: "OR",
    postal_code: "97214",
    country_code: "US",
    country: null,
  },
  enabled_fields: enabled,
  owner_name: "Owner",
  sender_full_names: null,
  sender_country: "US",
  recipient: "primary",
  updated_at: "2026-11-01T00:00:00+00:00",
});

describe("recipientPrefill", () => {
  it("never puts a disabled field's stored value in the props", () => {
    const prefill = recipientPrefill(data({ partner_name: false, kids_names: false, birthday: false }));
    const props = JSON.stringify(prefill);
    expect(props).not.toContain("Hidden");
    expect(props).not.toContain("1990-04-02");
    expect(prefill.household).toMatchObject({ first_name: "Ana", last_name: "Reyes", partner: null, kids: [] });
    expect(prefill.defaults).toMatchObject({ full_name: "", partner_name: "", kids_names: "", birthday: "" });
  });

  it("prefills enabled fields and the address", () => {
    const prefill = recipientPrefill(data({ partner_name: true, kids_names: true, birthday: true }));
    expect(prefill.household.partner).toEqual({ first: "Hidden", last: "Partner" });
    expect(prefill.household.kids).toEqual([{ first: "Hidden", last: "Kid" }]);
    expect(prefill.defaults).toMatchObject({
      birthday: "1990-04-02",
      email: "ana@example.test",
      address_line1: "1 Main St",
      postal_code: "97214",
      country_code: "US",
    });
  });
});
