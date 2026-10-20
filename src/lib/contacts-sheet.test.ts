import { describe, expect, it } from "vitest";
import type { ContactListRow } from "@/lib/queries/contacts";
import {
  changedValues,
  combineSends,
  draftFromNames,
  draftToValues,
  emailCount,
  householdEdited,
  householdPatchInput,
  moveCursor,
  namesFromValues,
  parseStoredLayout,
  sendPlan,
  sheetName,
  statusRank,
  NEEDS_ATTENTION,
  STATUS_RANK,
  toSheetRow,
  twoAnswers,
  validateHousehold,
  type HouseholdDraft,
  type StatusKey,
} from "./contacts-sheet";

const listRow: ContactListRow = {
  id: "00000000-0000-0000-0000-000000000001",
  fullName: "Ada Lovelace",
  partnerName: null,
  kidsNames: null,
  firstName: null,
  lastName: null,
  partnerFirstName: null,
  partnerLastName: null,
  kids: null,
  email: "ada@example.test",
  partnerEmail: null,
  birthday: null,
  addressLine1: "12 St James's Square",
  addressLine2: null,
  district: null,
  city: "London",
  stateRegion: null,
  postalCode: "SW1Y 4JH",
  countryCode: "GB",
  legacyCountry: null,
  sendStatus: "delivered",
  sendFailureReason: null,
  sendStatuses: {
    primary: { status: "delivered", failureReason: null },
    partner: { status: "none", failureReason: null },
  },
  needsAttention: false,
  updatedAfterSend: false,
  updatedAt: new Date("2026-10-01T12:00:00Z"),
};

describe("combineSends", () => {
  const none = { status: "none", failureReason: null } as const;
  const failed = { status: "failed", failureReason: "quota" } as const;
  const sent = { status: "sent", failureReason: null } as const;

  it("takes the better of the two statuses", () => {
    expect(combineSends(sent, { status: "opened", failureReason: null })).toMatchObject({
      status: "opened",
    });
  });

  it("ignores a person who was never emailed", () => {
    expect(combineSends(failed, none)).toEqual({ ...failed, needsAttention: true });
    expect(combineSends(none, sent)).toEqual({ ...sent, needsAttention: false });
    expect(combineSends(none, none)).toEqual({ ...none, needsAttention: false });
  });

  it("needs attention when either send does, even if the other went out", () => {
    expect(combineSends(sent, failed)).toEqual({ ...sent, needsAttention: true });
  });
});

describe("toSheetRow", () => {
  it("turns nulls into empty strings", () => {
    const row = toSheetRow(listRow, () => "Oct 1, 2026");
    expect(row.values.state_region).toBe("");
    expect(row.values.postal_code).toBe("SW1Y 4JH");
    expect(row.updatedAtIso).toBe("2026-10-01T12:00:00.000Z");
    expect(row.updatedAtLabel).toBe("Oct 1, 2026");
  });

  it("shows a recipient update over the delivery status", () => {
    expect(toSheetRow(listRow, String).status).toBe("delivered");
    expect(
      toSheetRow({ ...listRow, updatedAfterSend: true }, String).status,
    ).toBe("updated");
  });

  it("gives a single-email contact one status and a couple one per person", () => {
    expect(toSheetRow(listRow, String).people).toEqual([]);
    const couple = toSheetRow(
      {
        ...listRow,
        firstName: "Jen",
        partnerFirstName: "Mark",
        partnerEmail: "mark@example.test",
        sendStatuses: {
          primary: { status: "delivered", failureReason: null },
          partner: { status: "failed", failureReason: "rejected" },
        },
      },
      String,
    );
    expect(couple.values.partner_email).toBe("mark@example.test");
    expect(couple.people).toEqual([
      { name: "Jen", status: "delivered", failureReason: null },
      { name: "Mark", status: "failed", failureReason: "rejected" },
    ]);
  });

  it("names each person from the display names when the names aren't split", () => {
    const row = toSheetRow(
      { ...listRow, partnerName: "William King", partnerEmail: "will@example.test" },
      String,
    );
    expect(row.people.map((person) => person.name)).toEqual(["Ada", "William"]);
  });

  it("needs attention when either person does, until someone answers", () => {
    const half: ContactListRow = {
      ...listRow,
      partnerEmail: "will@example.test",
      sendStatuses: {
        primary: { status: "delivered", failureReason: null },
        partner: { status: "bounced", failureReason: null },
      },
      needsAttention: true,
    };
    expect(toSheetRow(half, String).needsAttention).toBe(true);
    expect(toSheetRow({ ...half, updatedAfterSend: true }, String).needsAttention).toBe(false);
    expect(toSheetRow(listRow, String).needsAttention).toBe(false);
  });
});

describe("emailCount", () => {
  it("counts one email per address", () => {
    expect(emailCount({ email: "a@x.test", partner_email: "b@x.test" })).toBe(2);
    expect(emailCount({ email: "a@x.test", partner_email: "" })).toBe(1);
    expect(emailCount({ email: "", partner_email: "" })).toBe(0);
  });
});

describe("twoAnswers", () => {
  const couple = {
    ...listRow,
    fullName: "Satya Rao",
    partnerName: "Mei Rao",
    firstName: "Satya",
    lastName: "Rao",
    partnerFirstName: "Mei",
    partnerLastName: "Rao",
    email: "satya@rao.test",
    partnerEmail: "mei@rao.test",
    addressLine1: "4410 Fremont Ave N",
    city: "Seattle",
    stateRegion: "WA",
    postalCode: "98103",
    countryCode: "US",
  };

  it("puts the saved contact beside a partner's reply and marks what differs", () => {
    const answers = twoAnswers(couple, {
      submissionId: "s1",
      from: "partner",
      savedBy: "primary",
      display: {
        full_name: "Satya Rao",
        partner_email: "mei@rao.test",
        address_line1: "4410 Fremont Ave N",
        address_line2: "Apt 2",
        city: "Seattle",
      },
    });
    expect(answers.saved.name).toBe("Satya");
    expect(answers.incoming.name).toBe("Mei");
    expect(answers.saved.lines).toEqual([
      {
        label: null,
        parts: [{ text: "4410 Fremont Ave N, Seattle, WA 98103", changed: false }],
      },
    ]);
    expect(answers.incoming.lines).toEqual([
      {
        label: null,
        parts: [
          { text: "4410 Fremont Ave N, ", changed: false },
          { text: "Apt 2", changed: true },
          { text: ", Seattle, WA 98103", changed: false },
        ],
      },
    ]);
  });

  it("adds a line for each other field the reply changes", () => {
    const answers = twoAnswers(couple, {
      submissionId: "s1",
      from: "primary",
      savedBy: "partner",
      display: { email: "satya@new.test", city: "Tacoma" },
    });
    expect(answers.saved.name).toBe("Mei");
    expect(answers.incoming.name).toBe("Satya");
    expect(answers.saved.lines[1]).toEqual({
      label: "Email",
      parts: [{ text: "satya@rao.test", changed: false }],
    });
    expect(answers.incoming.lines[1]).toEqual({
      label: "Email",
      parts: [{ text: "satya@new.test", changed: true }],
    });
    expect(answers.incoming.lines[0]?.parts[1]).toEqual({ text: "Tacoma", changed: true });
  });

  it("lists the parts when there is no street line", () => {
    const answers = twoAnswers(
      { ...couple, addressLine1: null, stateRegion: null, postalCode: null },
      { submissionId: "s1", from: "partner", savedBy: "primary", display: { country_code: "CA" } },
    );
    expect(answers.incoming.lines[0]?.parts).toEqual([
      { text: "Seattle, ", changed: false },
      { text: "Canada", changed: true },
    ]);
  });

  it("puts a reply's new country on the envelope's country line", () => {
    const answers = twoAnswers(
      couple,
      { submissionId: "s1", from: "partner", savedBy: "primary", display: { country_code: "CA" } },
      { senderCountry: "US" },
    );
    expect(answers.incoming.lines[0]?.parts.at(-1)).toEqual({ text: "CANADA", changed: true });
  });

  it("shows a reply's unrecognized country text only where no country is stored, as approval does", () => {
    const withCode = twoAnswers(couple, {
      submissionId: "s1",
      from: "partner",
      savedBy: "primary",
      display: { country: "Atlantis" },
    });
    expect(withCode.incoming.lines).toHaveLength(1);
    const answers = twoAnswers({ ...couple, countryCode: null }, {
      submissionId: "s1",
      from: "partner",
      savedBy: "primary",
      display: { country: "Atlantis" },
    });
    expect(answers.incoming.lines).toEqual([
      { label: null, parts: [{ text: "4410 Fremont Ave N, Seattle, WA 98103", changed: false }] },
      { label: "Country", parts: [{ text: "Atlantis (not on the list)", changed: true }] },
    ]);
  });

  it("names each side from the stored sender, whatever the payload holds", () => {
    const answers = twoAnswers(couple, {
      submissionId: "s1",
      from: "primary",
      savedBy: "partner",
      display: { partner_email: "mei@rao.test", city: "Tacoma" },
    });
    expect(answers.incoming.name).toBe("Satya");
    expect(answers.saved.name).toBe("Mei");
  });

  it("shows a cleared field as removed, but never clears an email or a name", () => {
    const answers = twoAnswers(
      { ...couple, addressLine2: "Apt 2", kidsNames: "Zoe" },
      {
        submissionId: "s1",
        from: "partner",
        savedBy: "primary",
        display: { address_line2: "", kids_names: "", email: "", full_name: "" },
      },
    );
    expect(answers.incoming.lines).toEqual([
      {
        label: null,
        parts: [{ text: "4410 Fremont Ave N, Seattle, WA 98103", changed: false }],
      },
      { label: "Line 2", parts: [{ text: "(removed)", changed: true }] },
      { label: "Kids", parts: [{ text: "(removed)", changed: true }] },
    ]);
    expect(answers.saved.lines[1]).toEqual({
      label: "Kids",
      parts: [{ text: "Zoe", changed: false }],
    });
  });
});

describe("changedValues", () => {
  it("keeps only the draft fields that differ from the row", () => {
    const { values } = toSheetRow(listRow, String);
    expect(
      changedValues(values, {
        city: "Paris",
        country_code: "GB",
        state_region: "",
      }),
    ).toEqual({ city: "Paris" });
    expect(changedValues(values, { email: "" })).toEqual({ email: "" });
    expect(changedValues(values, {})).toEqual({});
  });
});

describe("moveCursor", () => {
  it("moves and clamps to the row range", () => {
    expect(moveCursor("ArrowDown", 0, 3)).toBe(1);
    expect(moveCursor("ArrowDown", 2, 3)).toBe(2);
    expect(moveCursor("ArrowUp", 0, 3)).toBe(0);
    expect(moveCursor("End", 0, 3)).toBe(2);
    expect(moveCursor("Home", 2, 3)).toBe(0);
    expect(moveCursor("PageDown", 0, 25)).toBe(10);
    expect(moveCursor("PageUp", 4, 25)).toBe(0);
  });

  it("returns -1 when there are no rows", () => {
    expect(moveCursor("ArrowDown", 0, 0)).toBe(-1);
  });
});

describe("parseStoredLayout", () => {
  it("drops columns the sheet no longer has", () => {
    expect(
      parseStoredLayout(
        JSON.stringify({
          columnVisibility: { partner_name: false, city: false },
          columnSizing: { partner_name: 120, full_name: 200 },
        }),
        { columnIds: ["full_name", "city"] },
      ),
    ).toEqual({
      columnVisibility: { city: false },
      columnSizing: { full_name: 200 },
    });
  });

  it("returns a well-formed layout", () => {
    expect(
      parseStoredLayout(
        JSON.stringify({
          columnVisibility: { city: false },
          columnSizing: { city: 140 },
        }),
      ),
    ).toEqual({
      columnVisibility: { city: false },
      columnSizing: { city: 140 },
    });
  });

  it("drops malformed parts instead of throwing", () => {
    expect(parseStoredLayout(null)).toEqual({});
    expect(parseStoredLayout("{not json")).toEqual({});
    expect(parseStoredLayout('"text"')).toEqual({});
    expect(
      parseStoredLayout(
        JSON.stringify({
          columnVisibility: { city: "no" },
          columnSizing: { city: -5 },
        }),
      ),
    ).toEqual({ columnVisibility: undefined, columnSizing: undefined });
  });
});

describe("STATUS_RANK", () => {
  it("puts delivery problems first and updates last", () => {
    const keys = Object.keys(STATUS_RANK) as StatusKey[];
    expect(keys.sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b])).toEqual([
      "failed",
      "bounced",
      "complained",
      "unconfirmed",
      "none",
      "sent",
      "delivered",
      "opened",
      "updated",
    ]);
  });
});

const halfFailed = toSheetRow(
  {
    ...listRow,
    id: "00000000-0000-0000-0000-000000000002",
    firstName: "Jen",
    partnerFirstName: "Sam",
    partnerEmail: "sam@example.test",
    sendStatus: "delivered",
    sendStatuses: {
      primary: { status: "failed", failureReason: "rejected" },
      partner: { status: "delivered", failureReason: null },
    },
    needsAttention: true,
  },
  String,
);

describe("statusRank", () => {
  it("sorts a couple with one failed send by the failure, not the delivery", () => {
    expect(halfFailed.status).toBe("delivered");
    expect(statusRank(halfFailed)).toBe(STATUS_RANK.failed);
  });

  it("uses the status itself when nothing needs attention", () => {
    expect(statusRank(toSheetRow(listRow, String))).toBe(STATUS_RANK.delivered);
  });
});

describe("a person whose email was removed", () => {
  const bounced: ContactListRow = {
    ...listRow,
    firstName: "Jen",
    partnerFirstName: "Mark",
    partnerEmail: null,
    sendStatus: "bounced",
    sendStatuses: {
      primary: { status: "delivered", failureReason: null },
      partner: { status: "bounced", failureReason: null },
    },
    needsAttention: true,
  };

  it("no longer holds the row in Needs attention or sorts it with problems", () => {
    const row = toSheetRow(bounced, String);
    expect(row.needsAttention).toBe(false);
    expect(row.attention).toEqual([]);
    expect(row.status).toBe("delivered");
    expect(statusRank(row)).toBe(STATUS_RANK.delivered);
  });

  it("gets no chip of their own", () => {
    expect(toSheetRow(bounced, String).people).toEqual([]);
  });

  it("leaves a contact with no email at all as not sent", () => {
    const row = toSheetRow({ ...bounced, email: null }, String);
    expect(row.status).toBe("none");
    expect(row.needsAttention).toBe(false);
  });
});

describe("sendPlan", () => {
  const ada = toSheetRow(listRow, String);
  const noEmail = toSheetRow({ ...listRow, id: "00000000-0000-0000-0000-000000000003", email: null }, String);

  it("emails everyone with an address on each contact", () => {
    expect(sendPlan([ada, halfFailed, noEmail], { attentionOnly: false })).toEqual({
      input: { contactIds: [ada.id, halfFailed.id, noEmail.id] },
      contacts: 2,
      emails: 3,
      skipped: 1,
      replacedLinks: 2,
    });
  });

  it("resends only to the people whose last email needs a look", () => {
    expect(sendPlan([ada, halfFailed], { attentionOnly: true })).toEqual({
      input: { recipients: [{ contactId: halfFailed.id, recipient: "primary" }] },
      contacts: 1,
      emails: 1,
      skipped: 0,
      replacedLinks: 0,
    });
  });

  it("skips a failed person whose address was removed", () => {
    const removed = toSheetRow(
      {
        ...listRow,
        email: null,
        sendStatuses: {
          primary: { status: "failed", failureReason: "rejected" },
          partner: { status: "none", failureReason: null },
        },
        needsAttention: true,
      },
      String,
    );
    expect(removed.attention).toEqual([]);
  });
});

const holloway: ContactListRow = {
  ...listRow,
  fullName: "Jen Holloway",
  partnerName: "Mark Holloway",
  kidsNames: "Zoe, Max",
  firstName: "Jen",
  lastName: "Holloway",
  partnerFirstName: "Mark",
  partnerLastName: "Holloway",
  kids: [{ first: "Zoe" }, { first: "Max", last: "Holloway" }],
};

describe("sheetName", () => {
  it("summarizes the household for the Name cell", () => {
    expect(sheetName(toSheetRow(holloway, String).names)).toEqual({
      line: "Jen & Mark Holloway",
      kids: "2 kids",
      split: true,
    });
    expect(sheetName(toSheetRow(listRow, String).names)).toEqual({
      line: "Ada Lovelace",
      kids: null,
      split: false,
    });
  });
});

describe("namesFromValues", () => {
  it("derives the stored names, dropping blank kids and blank last names", () => {
    expect(
      namesFromValues({
        first_name: " Jen ",
        last_name: "Holloway",
        partner: { first: "Mark", last: "" },
        kids: [
          { first: "", last: "Holloway" },
          { first: "Zoe", last: "" },
          { first: "Max", last: "Jones" },
        ],
      }),
    ).toEqual({
      fullName: "Jen Holloway",
      partnerName: "Mark",
      kidsNames: "Zoe, Max Jones",
      firstName: "Jen",
      lastName: "Holloway",
      partnerFirstName: "Mark",
      partnerLastName: null,
      kids: [{ first: "Zoe" }, { first: "Max", last: "Jones" }],
    });
  });

  it("has no partner or kids when none are given", () => {
    expect(
      namesFromValues({ first_name: "Jen", last_name: "Holloway", partner: null, kids: [] }),
    ).toMatchObject({ partnerName: null, partnerFirstName: null, kids: null, kidsNames: null });
  });
});

describe("household drafts", () => {
  it("round-trips a stored household with following last names", () => {
    const draft = draftFromNames(holloway);
    expect(draft.kids.map((kid) => kid.lastEdited)).toEqual([false, false]);
    expect(draftToValues({ ...draft, last_name: "Holloway-Ng" })).toEqual({
      first_name: "Jen",
      last_name: "Holloway-Ng",
      partner: { first: "Mark", last: "Holloway-Ng" },
      kids: [
        { first: "Zoe", last: "Holloway-Ng" },
        { first: "Max", last: "Holloway-Ng" },
      ],
    });
  });

  it("keeps an edited last name", () => {
    const draft: HouseholdDraft = {
      first_name: "Priya",
      last_name: "Raman",
      partner: { first: "Daniel", last: "Okafor", lastEdited: true },
      kids: [{ first: "Asha", last: "Okafor", lastEdited: true }],
    };
    expect(draftToValues(draft).kids).toEqual([{ first: "Asha", last: "Okafor" }]);
  });

  it("is unedited until it differs from a split contact's names", () => {
    expect(householdEdited(holloway, draftFromNames(holloway))).toBe(false);
    const draft = draftFromNames(holloway);
    expect(
      householdEdited(holloway, { ...draft, kids: draft.kids.slice(0, 1) }),
    ).toBe(true);
    expect(householdEdited(listRow, draftFromNames(listRow))).toBe(true);
  });

  it("builds the patch the server validates", () => {
    expect(
      householdPatchInput({
        first_name: "Jen",
        last_name: "Holloway",
        partner: null,
        kids: [],
      }),
    ).toEqual({ first_name: "Jen", last_name: "Holloway" });
    expect(
      householdPatchInput({
        first_name: "Jen",
        last_name: "Holloway",
        partner: { first: "Mark", last: "" },
        kids: [{ first: "Zoe", last: "Holloway" }],
      }),
    ).toEqual({
      first_name: "Jen",
      last_name: "Holloway",
      partner_first_name: "Mark",
      partner_last_name: "",
      kids: [{ first: "Zoe", last: "Holloway" }],
    });
  });

  it("reports missing required names by field", () => {
    expect(
      validateHousehold({
        first_name: "Cher",
        last_name: " ",
        partner: { first: "", last: "" },
        kids: [{ first: "Zoe", last: "" }],
      }),
    ).toEqual({
      ok: false,
      errors: {
        partner_first_name: "Add a first name, or remove this row.",
      },
    });
    expect(
      validateHousehold({ first_name: "Cher", last_name: "Sarkisian", partner: null, kids: [] }),
    ).toMatchObject({ ok: true });
  });
});

describe("NEEDS_ATTENTION", () => {
  it("covers every send the owner should look at", () => {
    expect([...NEEDS_ATTENTION].sort()).toEqual(["bounced", "complained", "failed", "unconfirmed"]);
  });
});
