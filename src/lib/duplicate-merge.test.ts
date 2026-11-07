import { describe, expect, it } from "vitest";
import { planDuplicateMerge, type MergeContact } from "./duplicate-merge";

const blank: MergeContact = {
  fullName: "",
  partnerName: null,
  kidsNames: null,
  firstName: null,
  lastName: null,
  partnerFirstName: null,
  partnerLastName: null,
  kids: null,
  email: null,
  partnerEmail: null,
  personalEmail: null,
  partnerPersonalEmail: null,
  birthday: null,
  addressLine1: null,
  addressLine2: null,
  district: null,
  city: null,
  stateRegion: null,
  postalCode: null,
  countryCode: null,
  legacyCountry: null,
  notes: null,
};
const contact = (fields: Partial<MergeContact>): MergeContact => ({ ...blank, ...fields });

const theo = { fullName: "Theo Marsh", partnerName: "Nina Marsh" };
const nina = { fullName: "Nina Marsh", partnerName: "Theo Marsh" };

describe("planDuplicateMerge", () => {
  it("fills empty fields and leaves filled ones alone", () => {
    const plan = planDuplicateMerge(
      contact({ ...theo, birthday: "1980-01-01" }),
      contact({ ...theo, birthday: "1981-02-02", notes: "Met in Lisbon" }),
    );
    expect(plan.set).toEqual({ notes: "Met in Lisbon" });
    expect(plan.carried).toEqual([{ label: "Notes", value: "Met in Lisbon" }]);
    expect(plan.notKept).toEqual([{ label: "Birthday", value: "1981-02-02" }]);
  });

  it("never carries an email, and lists what is lost", () => {
    const plan = planDuplicateMerge(
      contact(theo),
      contact({ ...nina, email: "nina@x.test", personalEmail: "nina@home.test" }),
    );
    expect(plan.set).toEqual({});
    expect(plan.notKept).toEqual([
      { label: "Email", value: "nina@x.test" },
      { label: "Personal email", value: "nina@home.test" },
    ]);
  });

  it("does not list an email the kept contact already holds, in any slot and case", () => {
    const plan = planDuplicateMerge(
      contact({ ...theo, email: "SHARED@x.test" }),
      contact({ ...theo, partnerEmail: "shared@x.test", personalEmail: "shared@x.test" }),
    );
    expect(plan.notKept).toEqual([]);
  });

  it("takes the whole address only when the kept contact has none", () => {
    const address = { addressLine1: "1 Elm St", city: "Portland", countryCode: "US" };
    expect(planDuplicateMerge(contact(theo), contact({ ...theo, ...address })).set).toEqual(address);
    const plan = planDuplicateMerge(
      contact({ ...theo, city: "Seattle" }),
      contact({ ...theo, ...address }),
    );
    expect(plan.set).toEqual({});
    expect(plan.notKept).toEqual([{ label: "Address", value: "1 Elm St, Portland, US" }]);
  });

  it("gains a partner, with their email, when keeping the solo contact", () => {
    const plan = planDuplicateMerge(
      contact({ fullName: "Maya Chen", email: "maya@x.test" }),
      contact({ fullName: "Maya Chen", partnerName: "Jordan Lee", partnerEmail: "jordan@x.test" }),
    );
    expect(plan.set).toEqual({
      partnerName: "Jordan Lee",
      partnerFirstName: null,
      partnerLastName: null,
    });
  });

  it("gains the other person, not themselves, when the solo contact is the other's partner", () => {
    const plan = planDuplicateMerge(
      contact({ fullName: "Theo Marsh" }),
      contact({ ...nina, firstName: "Nina", lastName: "Marsh", email: "nina@x.test" }),
    );
    expect(plan.set).toEqual({
      partnerName: "Nina Marsh",
      partnerFirstName: "Nina",
      partnerLastName: "Marsh",
    });
    expect(plan.notKept).toEqual([{ label: "Email", value: "nina@x.test" }]);
  });

  it("adds no partner to a contact whose name already holds a couple", () => {
    const plan = planDuplicateMerge(
      contact({ fullName: "Theo & Nina Marsh" }),
      contact({ ...nina }),
    );
    expect(plan.set).toEqual({});
  });

  it("carries kids as a group", () => {
    const kids = [{ first: "Ada" }];
    expect(
      planDuplicateMerge(contact(theo), contact({ ...theo, kids, kidsNames: "Ada" })).set,
    ).toEqual({ kids, kidsNames: "Ada" });
    expect(
      planDuplicateMerge(contact({ ...theo, kidsNames: "Ben" }), contact({ ...theo, kids, kidsNames: "Ada" }))
        .notKept,
    ).toEqual([{ label: "Kids", value: "Ada" }]);
  });

  it("appends differing notes rather than dropping them", () => {
    expect(
      planDuplicateMerge(contact({ ...theo, notes: "One" }), contact({ ...theo, notes: "Two" })).set,
    ).toEqual({ notes: "One\n\nTwo" });
  });

  it("reports notes it cannot fit", () => {
    const plan = planDuplicateMerge(
      contact({ ...theo, notes: "a".repeat(1990) }),
      contact({ ...theo, notes: "b".repeat(20) }),
    );
    expect(plan.set).toEqual({});
    expect(plan.notKept).toEqual([{ label: "Notes", value: "b".repeat(20) }]);
  });

  it("reports a person who would disappear, with their email", () => {
    const plan = planDuplicateMerge(
      contact({ fullName: "Theo Marsh", partnerName: "Nina Marsh" }),
      contact({ fullName: "Nina Marsh", partnerName: "Mike Hart", partnerEmail: "mike@x.test" }),
    );
    expect(plan.set).toEqual({});
    expect(plan.notKept).toContainEqual({ label: "Partner email", value: "mike@x.test" });
    expect(plan.notKept).toContainEqual({ label: "Person", value: "Mike Hart" });
  });

  it("does not move the other person's birthday onto the kept person", () => {
    const plan = planDuplicateMerge(contact(theo), contact({ ...nina, birthday: "1985-03-12" }));
    expect(plan.set).toEqual({});
    expect(plan.notKept).toEqual([{ label: "Birthday", value: "1985-03-12" }]);
  });

  it("reports an address that differs only in a second line or country", () => {
    const street = { addressLine1: "1 Elm St", city: "Portland" };
    const plan = planDuplicateMerge(
      contact({ ...theo, ...street }),
      contact({ ...theo, ...street, addressLine2: "Apt 4" }),
    );
    expect(plan.notKept).toEqual([{ label: "Address", value: "1 Elm St, Apt 4, Portland" }]);
    expect(
      planDuplicateMerge(contact({ ...theo, ...street, countryCode: "US" }), contact({ ...theo, ...street, countryCode: "CA" }))
        .notKept,
    ).toEqual([{ label: "Address", value: "1 Elm St, Portland, CA" }]);
  });

  it("never names a person as their own partner from a couple typed into one field", () => {
    const plan = planDuplicateMerge(contact({ fullName: "Nina Marsh" }), contact({ fullName: "Theo & Nina Marsh" }));
    expect(plan.set).toEqual({});
    expect(plan.notKept).toEqual([{ label: "Person", value: "Theo & Nina Marsh" }]);
  });

  it("reports a partner who would disappear", () => {
    const plan = planDuplicateMerge(
      contact({ fullName: "Theo Marsh", partnerName: "Nina Marsh" }),
      contact({ fullName: "Theo Marsh", partnerName: "Priya Nair" }),
    );
    expect(plan.notKept).toEqual([{ label: "Person", value: "Priya Nair" }]);
  });

  it("fills a birthday for couples in one field and for matching labels", () => {
    expect(
      planDuplicateMerge(
        contact({ fullName: "Theo & Nina Marsh" }),
        contact({ fullName: "Theo & Nina Marsh", birthday: "1980-06-15" }),
      ).set,
    ).toEqual({ birthday: "1980-06-15" });
    expect(
      planDuplicateMerge(
        contact({ fullName: "The Smiths" }),
        contact({ fullName: "The Smiths", birthday: "1980-06-15" }),
      ).set,
    ).toEqual({ birthday: "1980-06-15" });
  });
});
