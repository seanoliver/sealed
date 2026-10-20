import { describe, it, expect } from "vitest";
import {
  DISPLAY_VALUE_MAX,
  dropDisabledFields,
  parseSubmissionForDisplay,
  parseSubmissionPayload,
  submissionDisplaySchema,
  submittedPeople,
  type EnabledFields,
} from "./submission";

const allEnabled: EnabledFields = {
  partner_name: true,
  kids_names: true,
  birthday: true,
};

describe("submissionDisplaySchema", () => {
  it("accepts an empty object", () => {
    expect(submissionDisplaySchema.safeParse({}).success).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "hi"],
    ["a number", 42],
    ["a boolean", true],
    ["an array", ["full_name", "x"]],
  ])("rejects non-object payload: %s", (_label, payload) => {
    expect(submissionDisplaySchema.safeParse(payload).success).toBe(false);
  });

  it("drops unknown keys, including a smuggled notes and __proto__", () => {
    // JSON.parse (how jsonb actually arrives) creates a REAL own __proto__
    // key, unlike an object literal where it would be inert.
    const result = submissionDisplaySchema.parse(
      JSON.parse(
        '{"full_name":"Ada","notes":"owner-private","unknown_key":"x","__proto__":"y"}',
      ),
    );
    expect(result).toEqual({ full_name: "Ada" });
    expect(Object.keys(result)).toEqual(["full_name"]);
  });

  it("drops non-string values under known keys instead of failing the card", () => {
    const result = submissionDisplaySchema.parse({
      full_name: "Ada",
      city: 42,
      email: { nested: true },
      country: null,
    });
    expect(result).toEqual({ full_name: "Ada" });
  });

  it("truncates huge values for display with an ellipsis", () => {
    const long = "a".repeat(DISPLAY_VALUE_MAX + 50);
    const result = submissionDisplaySchema.parse({ full_name: long });
    expect(result.full_name).toHaveLength(DISPLAY_VALUE_MAX + 1);
    expect(result.full_name?.endsWith("…")).toBe(true);
  });

  it("leaves values at the cap untouched", () => {
    const exact = "a".repeat(DISPLAY_VALUE_MAX);
    const result = submissionDisplaySchema.parse({ full_name: exact });
    expect(result.full_name).toBe(exact);
  });

  it("passes XSS strings through as plain strings (escaping is React's job)", () => {
    const result = submissionDisplaySchema.parse({
      full_name: "<script>alert(1)</script>",
    });
    expect(result.full_name).toBe("<script>alert(1)</script>");
  });
});

describe("dropDisabledFields", () => {
  it("removes fields the book disables", () => {
    const gated = dropDisabledFields(
      { full_name: "Ada", kids_names: "smuggled", partner_name: "p", birthday: "2000-01-01" },
      { partner_name: true, kids_names: false, birthday: false },
    );
    expect(gated).toEqual({ full_name: "Ada", partner_name: "p" });
  });

  it("removes household partner and kids keys the book disables", () => {
    const gated = dropDisabledFields(
      {
        first_name: "Ada",
        partner_first_name: "Sam",
        partner_last_name: "Lee",
        kids: [{ first: "Zoe" }],
      },
      { partner_name: false, kids_names: false, birthday: true },
    );
    expect(gated).toEqual({ first_name: "Ada" });
  });

  it("keeps everything when all fields are enabled", () => {
    const data = { full_name: "Ada", kids_names: "k" };
    expect(dropDisabledFields(data, allEnabled)).toEqual(data);
  });

  it("does not mutate its input", () => {
    const data = { full_name: "Ada", kids_names: "k" };
    dropDisabledFields(data, { ...allEnabled, kids_names: false });
    expect(data.kids_names).toBe("k");
  });
});

describe("parseSubmissionForDisplay", () => {
  it("returns null for non-object payloads", () => {
    expect(parseSubmissionForDisplay(null, allEnabled)).toBeNull();
    expect(parseSubmissionForDisplay([1, 2], allEnabled)).toBeNull();
    expect(parseSubmissionForDisplay("scalar", allEnabled)).toBeNull();
  });

  it("gates disabled fields out of the parsed result", () => {
    const result = parseSubmissionForDisplay(
      { full_name: "Ada", kids_names: "SMUGGLED", unknown_key: "x" },
      { partner_name: true, kids_names: false, birthday: true },
    );
    expect(result).toEqual({ full_name: "Ada" });
  });

  it("never throws on hostile shapes", () => {
    for (const payload of [undefined, 0, "", () => {}, Symbol("x")]) {
      expect(() => parseSubmissionForDisplay(payload, allEnabled)).not.toThrow();
    }
  });
});

describe("parseSubmissionForDisplay (household payloads)", () => {
  it("formats household names into display strings", () => {
    const result = parseSubmissionForDisplay(
      {
        first_name: "Jane",
        last_name: "Smith",
        partner_first_name: "Sam",
        partner_last_name: "Lee",
        kids: [
          { first: "Zoe", last: "Smith" },
          { first: "Max", last: "Jones" },
        ],
        city: "Geneva",
      },
      allEnabled,
    );
    expect(result).toEqual({
      full_name: "Jane Smith",
      partner_name: "Sam Lee",
      kids_names: "Zoe, Max Jones",
      city: "Geneva",
    });
  });

  it("prefers household names over legacy strings in the same payload", () => {
    const result = parseSubmissionForDisplay(
      { first_name: "Jane", last_name: "Smith", full_name: "Smuggled", kids_names: "x" },
      allEnabled,
    );
    expect(result?.full_name).toBe("Jane Smith");
    expect(result?.kids_names).toBeUndefined();
  });

  it("gates disabled partner and kids before formatting", () => {
    const result = parseSubmissionForDisplay(
      {
        first_name: "Jane",
        last_name: "Smith",
        partner_first_name: "Sam",
        kids: [{ first: "Zoe" }],
      },
      { partner_name: false, kids_names: false, birthday: true },
    );
    expect(result?.partner_name).toBeUndefined();
    expect(result?.kids_names).toBeUndefined();
  });

  it("skips malformed kid items instead of failing the card", () => {
    const result = parseSubmissionForDisplay(
      { first_name: "Jane", last_name: "Smith", kids: ["Zoe", { first: "Max" }, null] },
      allEnabled,
    );
    expect(result?.kids_names).toBe("Max");
  });
});

const ALL_ON = { partner_name: true, kids_names: true, birthday: true };

describe("parseSubmissionPayload", () => {
  it("drops the partner and kids a book disables", () => {
    expect(
      parseSubmissionPayload(
        {
          first_name: "Jane",
          last_name: "Smith",
          partner_first_name: "Sam",
          partner_last_name: "Lee",
          kids: [{ first: "Zoe" }],
          kids_names: "Zoe",
          birthday: "1990-01-01",
        },
        { partner_name: false, kids_names: false, birthday: false },
      ),
    ).toEqual({ success: true, data: { first_name: "Jane", last_name: "Smith" } });
  });

  it("parses a legacy payload", () => {
    const result = parseSubmissionPayload({
      full_name: "Greta Approve",
      kids_names: "Zoe, Max",
      notes: "smuggled",
    }, ALL_ON);
    expect(result).toEqual({
      success: true,
      data: { full_name: "Greta Approve", kids_names: "Zoe, Max" },
    });
  });

  it("parses a household payload and strips legacy name keys", () => {
    const result = parseSubmissionPayload({
      first_name: "Jane",
      last_name: "Smith",
      partner_first_name: "Sam",
      kids: [{ first: "Zoe", last: "Smith" }],
      full_name: "Smuggled",
      email: "jane@example.com",
    }, ALL_ON);
    expect(result).toEqual({
      success: true,
      data: {
        first_name: "Jane",
        last_name: "Smith",
        partner_first_name: "Sam",
        kids: [{ first: "Zoe", last: "Smith" }],
        email: "jane@example.com",
      },
    });
  });

  it.each([
    ["missing last name", { first_name: "Jane", full_name: "Jane Smith" }],
    ["missing first name", { last_name: "Smith", full_name: "Jane Smith" }],
    ["11 kids", {
      first_name: "Jane",
      last_name: "Smith",
      kids: Array.from({ length: 11 }, (_, i) => ({ first: `K${i}` })),
    }],
    ["kid with an extra key", {
      first_name: "Jane",
      last_name: "Smith",
      kids: [{ first: "Zoe", middle: "Q" }],
    }],
    ["name over 80 characters", { first_name: "x".repeat(81), last_name: "Smith" }],
    ["legacy payload without a name", { city: "Geneva" }],
    ["non-object payload", ["first_name"]],
  ])("rejects %s", (_label, payload) => {
    expect(parseSubmissionPayload(payload, ALL_ON).success).toBe(false);
  });
});

describe("submittedPeople", () => {
  it("keeps a full name sent without first and last names", () => {
    expect(
      submittedPeople({ full_name: "张伟", partner_name: "李娜" }, allEnabled),
    ).toEqual([
      { full: "张伟", first: null, last: null },
      { full: "李娜", first: null, last: null },
    ]);
  });

  it("builds the full name from first and last names", () => {
    expect(
      submittedPeople(
        {
          full_name: "ignored",
          first_name: "华",
          last_name: "李",
          partner_first_name: "乐乐",
          partner_last_name: "王",
        },
        allEnabled,
      ),
    ).toEqual([
      { full: "华 李", first: "华", last: "李" },
      { full: "乐乐 王", first: "乐乐", last: "王" },
    ]);
  });

  it("drops the partner when the book doesn't collect one", () => {
    expect(
      submittedPeople(
        { first_name: "华", last_name: "李", partner_first_name: "乐乐", partner_last_name: "王" },
        { ...allEnabled, partner_name: false },
      ),
    ).toEqual([
      { full: "华 李", first: "华", last: "李" },
      { full: null, first: null, last: null },
    ]);
  });

  it("returns no one for a payload that isn't an object", () => {
    expect(submittedPeople(["张伟"], allEnabled)).toEqual([]);
    expect(submittedPeople(null, allEnabled)).toEqual([]);
  });
});

describe("country text from before codes", () => {
  it("maps a stored country name to its code for approval", () => {
    const parsed = parseSubmissionPayload({ full_name: "Ada", country: "United Kingdom" }, allEnabled);
    expect(parsed).toEqual({ success: true, data: { full_name: "Ada", country_code: "GB" } });
  });

  it("drops text no code matches rather than refusing the reply", () => {
    const parsed = parseSubmissionPayload({ full_name: "Ada", country: "Atlantis" }, allEnabled);
    expect(parsed).toEqual({ success: true, data: { full_name: "Ada" } });
  });

  it("shows the code for a known name and keeps unknown text for display", () => {
    expect(parseSubmissionForDisplay({ country: "Holland" }, allEnabled)).toEqual({ country_code: "NL" });
    expect(parseSubmissionForDisplay({ country: "Atlantis" }, allEnabled)).toEqual({ country: "Atlantis" });
    expect(parseSubmissionForDisplay({ country_code: "DE" }, allEnabled)).toEqual({ country_code: "DE" });
  });

  it("rejects a code that isn't on the list", () => {
    expect(parseSubmissionPayload({ full_name: "Ada", country_code: "XX" }, allEnabled)).toEqual({
      success: false,
    });
  });
});
