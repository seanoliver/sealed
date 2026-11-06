import { describe, expect, it } from "vitest";
import { describeEvent, eventActor, MAX_VALUE_CHARS, recipientName } from "./history";

// A full contacts row as apply_token_reply stores it (to_jsonb minus timestamps).
const row = {
  id: "5f2b5def-8889-4f3e-983e-c53795dbc455",
  book_id: "64ddc4fe-353f-4c2a-9d82-8c967ada8dd1",
  full_name: "Priya Raman",
  first_name: "Priya",
  last_name: "Raman",
  partner_name: null,
  partner_first_name: null,
  partner_last_name: null,
  kids_names: null,
  kids: null,
  email: "priya@example.test",
  partner_email: null,
  birthday: null,
  address_line1: "22 Belgrave Road",
  address_line2: null,
  district: null,
  city: "Bristol",
  state_region: null,
  postal_code: "BS8 1TH",
  country_code: "GB",
  country: null,
  notes: null,
};

const names = {
  fullName: "Priya Raman",
  firstName: "Priya",
  partnerName: "Sam Raman",
  partnerFirstName: "Sam",
};

describe("describeEvent", () => {
  it("lists only the changed fields of a token reply, with the country's labels", () => {
    const after = { ...row, address_line1: "7 Royal York Crescent", postal_code: "BS8 4JX" };
    expect(
      describeEvent({ source: "token", diff: { before: row, after, payload: { postal_code: "BS8 4JX" } } }),
    ).toEqual({
      kind: "changed",
      undo: false,
      rows: [
        { label: "Street address", before: "22 Belgrave Road", after: "7 Royal York Crescent" },
        { label: "Postcode", before: "BS8 1TH", after: "BS8 4JX" },
      ],
    });
  });

  it("names the deleted contact on a merge, even when nothing else changed", () => {
    expect(
      describeEvent({
        source: "owner",
        diff: { before: {}, after: {}, merged_from: { full_name: "Nina Marsh" } },
      }),
    ).toEqual({ kind: "changed", rows: [], undo: false, mergedFrom: "Nina Marsh" });
  });

  it("reads a one-click confirm as confirmed", () => {
    expect(describeEvent({ source: "token", diff: { before: row, after: row, payload: {} } })).toEqual({
      kind: "confirmed",
    });
  });

  it("treats a reply that only moved the name split as confirmed", () => {
    const after = { ...row, first_name: "Priya R.", last_name: "Raman", id: "other" };
    expect(describeEvent({ source: "token", diff: { before: row, after, payload: {} } })).toEqual({
      kind: "confirmed",
    });
  });

  it("reads an older token reply that stored no after as details changed", () => {
    const entry = describeEvent({
      source: "token",
      diff: { before: row, payload: { first_name: "Ada", last_name: "King", email: "" } },
    });
    expect(entry).toEqual({ kind: "unknown" });
  });

  it("formats an owner edit of changed fields only", () => {
    const entry = describeEvent(
      {
        source: "owner",
        diff: {
          before: { birthday: null, country_code: null, country: "England" },
          after: { birthday: "1990-03-14", country_code: "GB", country: null },
        },
      },
      { countryCode: "GB" },
    );
    expect(entry).toEqual({
      kind: "changed",
      undo: false,
      rows: [
        { label: "Birthday", before: "none", after: "Mar 14" },
        { label: "Country", before: "England", after: "United Kingdom" },
      ],
    });
  });

  it("shows the year when only the birthday's year changed", () => {
    const entry = describeEvent({
      source: "agent",
      diff: { before: { birthday: "1990-03-14" }, after: { birthday: "1991-03-14" } },
    });
    expect(entry).toMatchObject({
      rows: [{ label: "Birthday", before: "Mar 14, 1990", after: "Mar 14, 1991" }],
    });
  });

  it("labels address fields from the contact's country when the diff has none", () => {
    const diff = { before: { postal_code: "98103" }, after: { postal_code: "98104" } };
    expect(describeEvent({ source: "owner", diff }, { countryCode: "US" })).toMatchObject({
      rows: [{ label: "ZIP code" }],
    });
    expect(describeEvent({ source: "owner", diff })).toMatchObject({
      rows: [{ label: "Postal code" }],
    });
  });

  it("shows the display name and skips the first and last name split", () => {
    const entry = describeEvent({
      source: "owner",
      diff: {
        before: { full_name: "Ada Lovelace", first_name: "Ada", last_name: "Lovelace", partner_name: null },
        after: { full_name: "Ada King", first_name: "Ada", last_name: "King", partner_name: "William King" },
      },
    });
    expect(entry).toMatchObject({
      rows: [
        { label: "Name", before: "Ada Lovelace", after: "Ada King" },
        { label: "Partner", before: "none", after: "William King" },
      ],
    });
  });

  it("reports a split-only owner edit as details changed", () => {
    const entry = describeEvent({
      source: "owner",
      diff: { before: { first_name: "Mary Ann", last_name: "Smith" }, after: { first_name: "Mary", last_name: "Ann Smith" } },
    });
    expect(entry).toEqual({ kind: "unknown" });
  });

  it("shows no name rows when an imported contact's first save only adds the split", () => {
    const entry = describeEvent({
      source: "owner",
      diff: {
        before: { first_name: null, last_name: null, partner_first_name: null, kids: null, city: "Bath" },
        after: { first_name: "Mary", last_name: "Smith", partner_first_name: "John", kids: [{ first: "Byron" }], city: "Wells" },
      },
    });
    expect(entry).toMatchObject({ rows: [{ label: "City" }] });
    expect((entry as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it("skips a display name that only one side of a partial diff carries", () => {
    for (const key of ["full_name", "partner_name", "kids_names"]) {
      for (const diff of [
        { before: { city: "Bath" }, after: { [key]: "Mary Smith", city: "Wells" } },
        { before: { [key]: "Mary Smith", city: "Bath" }, after: { city: "Wells" } },
      ]) {
        const entry = describeEvent({ source: "owner", diff });
        expect((entry as { rows: { label: string }[] }).rows.map((r) => r.label)).toEqual(["City"]);
      }
    }
  });

  it("shows a kids change from the kids names", () => {
    const entry = describeEvent({
      source: "owner",
      diff: { before: { kids_names: null }, after: { kids_names: "Byron, Zoe" } },
    });
    expect(entry).toMatchObject({ rows: [{ label: "Kids", before: "none", after: "Byron, Zoe" }] });
  });

  it("reads a create as added, from any source", () => {
    for (const source of ["owner", "agent", "submission"]) {
      expect(describeEvent({ source, diff: { after: { full_name: "Ada" } } })).toEqual({ kind: "created" });
    }
  });

  it("marks an agent undo", () => {
    const entry = describeEvent({
      source: "agent",
      diff: { before: { city: "Paris" }, after: { city: "Boston" }, undo_of: "e1" },
    });
    expect(entry).toMatchObject({ kind: "changed", undo: true });
  });

  it("never throws on odd jsonb and never returns JSON", () => {
    const odd: unknown[] = [
      null,
      42,
      "text",
      [],
      [{ before: {} }],
      {},
      { before: [1, 2], after: "x" },
      { before: null, after: null },
      { before: {}, payload: 5 },
      { before: { city: { nested: { deep: true } } }, after: { city: ["a"] } },
      { before: { kids: "Zoe" }, after: { kids: [1, 2] } },
      { before: { birthday: "1990-13-40" }, after: { birthday: 19900314 } },
      JSON.parse('{"before":{"__proto__":{"city":"x"}},"after":{"__proto__":{"city":"y"},"constructor":"z"}}'),
    ];
    for (const diff of odd) {
      for (const source of ["owner", "token", "agent", "submission", "mystery"]) {
        const entry = describeEvent({ source, diff });
        if (entry.kind === "changed") {
          for (const r of entry.rows) {
            expect(r.before).not.toMatch(/[{}]/);
            expect(r.after).not.toMatch(/[{}]/);
          }
        }
      }
    }
    expect(describeEvent({ source: "owner", diff: [] })).toEqual({ kind: "unknown" });
    expect(describeEvent({ source: "owner", diff: "x" })).toEqual({ kind: "unknown" });
    expect(describeEvent({ source: "token", diff: {} })).toEqual({ kind: "unknown" });
    expect(
      describeEvent({ source: "owner", diff: { before: { city: { a: 1 } }, after: { city: "Paris" } } }),
    ).toMatchObject({ rows: [{ label: "City", before: "(unreadable)", after: "Paris" }] });
    expect(
      describeEvent({ source: "owner", diff: { before: { birthday: "1990-13-40" }, after: { birthday: null } } }),
    ).toMatchObject({ rows: [{ label: "Birthday", before: "1990-13-40", after: "none" }] });
  });

  it("caps a huge value", () => {
    const huge = "x".repeat(100_000);
    const entry = describeEvent({ source: "owner", diff: { before: { notes: null }, after: { notes: huge } } });
    if (entry.kind !== "changed") throw new Error("expected a change");
    expect(entry.rows[0].after).toHaveLength(MAX_VALUE_CHARS);
    expect(entry.rows[0].after.endsWith("…")).toBe(true);
  });
});

describe("eventActor", () => {
  it("names each source", () => {
    expect(eventActor({ source: "owner" }, names)).toBe("You");
    expect(eventActor({ source: "agent", agentName: "Holiday helper" }, names)).toBe(
      "Agent: Holiday helper",
    );
    expect(eventActor({ source: "agent", agentName: null }, names)).toBe("Agent: removed token");
    expect(eventActor({ source: "submission" }, names)).toBe("Permalink submission");
    expect(eventActor({ source: "token", recipient: "primary" }, names)).toBe(
      "Priya, through their link",
    );
    expect(eventActor({ source: "token", recipient: "partner" }, names)).toBe(
      "Sam, through their link",
    );
    expect(eventActor({ source: "token", recipient: null }, names)).toBe(
      "Priya, through their link",
    );
  });
});

describe("recipientName", () => {
  it("uses the first name, or the household label as a whole", () => {
    const legacy = { fullName: "June Carter", firstName: null, partnerName: null, partnerFirstName: null };
    expect(recipientName(legacy)).toBe("June");
    expect(recipientName({ ...legacy, fullName: "The Smiths" })).toBe("The Smiths");
    expect(recipientName({ ...legacy, fullName: "Grandma" })).toBe("Grandma");
    expect(recipientName(legacy, { recipient: "partner" })).toBe("June");
    expect(recipientName({ ...legacy, fullName: "  " })).toBe("The recipient");
  });
});
