import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  clearRateLimits,
  getContactEmails,
  getSubmissionStatus,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedEmailSend,
  seedPendingReply,
  seedUpdateToken,
} from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("partner-owner");

let page: Page;
let bookId: string;
let hollowayId: string;
let raoId: string;
let raoReplyId: string;
let okaforId: string;
let okaforReplyId: string;
let adaId: string;

const household = (firstName: string, lastName: string, partnerFirstName: string) => ({
  firstName,
  lastName,
  partnerFirstName,
  partnerLastName: lastName,
});

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await clearRateLimits();
  page = await browser.newPage();
  await signupAndLogin(page, ownerEmail);
  bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("partner-book"),
    displayName: "Partner Owner",
    enabledFields: { partner_name: true, kids_names: false, birthday: false },
  });

  hollowayId = await seedContact({
    bookId,
    fullName: "Jen Holloway",
    email: "jen@holloway.test",
    partnerEmail: "mark@holloway.test",
    household: household("Jen", "Holloway", "Mark"),
    addressLine1: "2140 NE Alberta St",
    city: "Portland",
  });
  await seedEmailSend({ contactId: hollowayId, bookId, resendId: `re_jen_${Date.now()}`, status: "delivered" });
  await seedEmailSend({
    contactId: hollowayId,
    bookId,
    resendId: null,
    status: "failed",
    failureReason: "rejected",
    recipient: "partner",
  });

  raoId = await seedContact({
    bookId,
    fullName: "Satya Rao",
    email: "satya@rao.test",
    partnerEmail: "mei@rao.test",
    household: household("Satya", "Rao", "Mei"),
    addressLine1: "4410 Fremont Ave N",
    city: "Seattle",
  });
  raoReplyId = await seedPendingReply({
    bookId,
    contactId: raoId,
    savedBy: "primary",
    payload: {
      first_name: "Satya",
      last_name: "Rao",
      partner_first_name: "Mei",
      partner_last_name: "Rao",
      partner_email: "mei@rao.test",
      address_line1: "4410 Fremont Ave N",
      address_line2: "Apt 2",
      city: "Seattle",
    },
  });

  okaforId = await seedContact({
    bookId,
    fullName: "Priya Okafor",
    email: "priya@okafor.test",
    partnerEmail: "daniel@okafor.test",
    household: household("Priya", "Okafor", "Daniel"),
    addressLine1: "1428 Alder St",
    city: "Portland",
  });
  okaforReplyId = await seedPendingReply({
    bookId,
    contactId: okaforId,
    savedBy: "partner",
    payload: {
      first_name: "Priya",
      last_name: "Okafor",
      partner_first_name: "Daniel",
      partner_last_name: "Okafor",
      email: "priya@okafor.test",
      address_line1: "99 Elm St",
      city: "Salem",
    },
  });

  adaId = await seedContact({ bookId, fullName: "Ada Lovelace", email: "ada@lovelace.test" });
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await page.close();
});

async function openDashboard() {
  await page.goto("/dashboard");
  await page.waitForFunction(() => {
    const el = document.querySelector('table[aria-label="Contacts"]');
    return (
      el !== null && Object.keys(el).some((k) => k.startsWith("__reactFiber"))
    );
  });
}

const table = () => page.getByRole("table", { name: "Contacts" });
const row = (name: string) => table().locator("tbody tr").filter({ hasText: name });

test("each person gets a chip and either one can need attention", async () => {
  await openDashboard();
  await expect(row("Jen & Mark Holloway")).toContainText("Jen · Delivered");
  await expect(row("Jen & Mark Holloway")).toContainText("Mark · Invalid email");
  await expect(row("Ada Lovelace")).toContainText("Not sent");
  await expect(row("Ada Lovelace")).not.toContainText("·");

  const filter = page.getByRole("button", { name: "Needs attention (1)" });
  await filter.click();
  await expect(table().locator("tbody tr")).toHaveCount(1);
  await expect(row("Jen & Mark Holloway")).toBeVisible();
  await filter.click();
});

test("the send dialog counts emails, not contacts", async () => {
  await openDashboard();
  await page.getByRole("button", { name: "Send to all shown" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm address request" })).toContainText(
    "Send 7 emails to the 4 contacts shown",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("the email cell shows both addresses and edits them together", async () => {
  await openDashboard();
  await expect(row("Jen & Mark Holloway")).toContainText("jen@holloway.test");
  await expect(row("Jen & Mark Holloway")).toContainText("mark@holloway.test");
  await expect(row("Ada Lovelace").getByRole("textbox")).toHaveCount(0);

  await row("Ada Lovelace").getByRole("button", { name: "Edit Ada Lovelace" }).click();
  await expect(table().getByRole("textbox", { name: "Email", exact: true })).toHaveValue(
    "ada@lovelace.test",
  );
  const partner = table().getByRole("textbox", { name: "Partner email" });
  await expect(partner).toHaveValue("");
  await partner.fill("will@lovelace.test");
  await partner.press("Enter");

  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(row("Ada Lovelace")).toContainText("will@lovelace.test");
  expect((await getContactEmails(adaId)).partnerEmail).toBe("will@lovelace.test");
});

test("an email the partner already has is refused", async () => {
  await openDashboard();
  await row("Jen & Mark Holloway").getByRole("button", { name: "Edit Jen Holloway" }).click();
  const partner = table().getByRole("textbox", { name: "Partner email" });
  await partner.fill("JEN@holloway.test");
  await partner.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "must differ" })).toBeVisible();
  await partner.press("Escape");
  expect((await getContactEmails(hollowayId)).partnerEmail).toBe("mark@holloway.test");
});

test("Escape closes the two answers without choosing", async () => {
  await openDashboard();
  const chip = row("Satya & Mei Rao").getByRole("button", { name: "Two answers" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByRole("region", { name: "Two answers for Satya Rao" });
  await expect(panel).toBeFocused();
  await expect(panel).toContainText("Satya · saved now");
  await expect(panel.locator("mark")).toHaveText(["Apt 2"]);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(await getSubmissionStatus(raoReplyId)).toBe("pending");
});

test("using the partner's answer applies it to the contact", async () => {
  await openDashboard();
  await row("Satya & Mei Rao").getByRole("button", { name: "Two answers" }).click();
  await page.getByRole("button", { name: "Use Mei's" }).click();
  await expect(row("Satya & Mei Rao").getByRole("button", { name: "Two answers" })).toHaveCount(0);
  expect(await getSubmissionStatus(raoReplyId)).toBe("approved");
  expect((await getContactEmails(raoId)).addressLine2).toBe("Apt 2");
});

test("keeping the saved answer rejects the reply", async () => {
  await openDashboard();
  await row("Priya & Daniel Okafor").getByRole("button", { name: "Two answers" }).click();
  const panel = page.getByRole("region", { name: "Two answers for Priya Okafor" });
  await expect(panel).toContainText("Daniel · saved now");
  await panel.getByRole("button", { name: "Keep Daniel's" }).click();
  await expect(row("Priya & Daniel Okafor").getByRole("button", { name: "Two answers" })).toHaveCount(0);
  expect(await getSubmissionStatus(okaforReplyId)).toBe("rejected");
  await expect(row("Priya & Daniel Okafor")).toContainText("1428 Alder St");
});

test("phones see both emails and resolve answers in the card", async () => {
  const reply = await seedPendingReply({
    bookId,
    contactId: okaforId,
    savedBy: "partner",
    payload: { first_name: "Priya", last_name: "Okafor", city: "Salem" },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.goto("/dashboard");
    const card = page
      .getByRole("list", { name: "Contacts" })
      .getByRole("listitem")
      .filter({ hasText: "Priya & Daniel Okafor" });
    await expect(card).toContainText("priya@okafor.test · daniel@okafor.test");
    const use = card.getByRole("button", { name: "Use Priya's" });
    expect((await use.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await use.click();
    await expect(card.getByRole("button", { name: "Use Priya's" })).toHaveCount(0);
    expect(await getSubmissionStatus(reply)).toBe("approved");
  } finally {
    await page.setViewportSize({ width: 1280, height: 720 });
  }
});

test("the export has a partner email column", async () => {
  const response = await page.request.get("/dashboard/export");
  const [header, ...lines] = (await response.text()).split("\r\n");
  const column = header.split(",").indexOf("partner_email");
  expect(column).toBeGreaterThan(-1);
  const jen = lines.find((line) => line.startsWith("Jen Holloway"));
  expect(jen?.split(",")[column]).toBe("mark@holloway.test");
});

test("the partner's link labels both people neutrally and shows their own email", async () => {
  const token = await seedUpdateToken(hollowayId, { recipient: "partner" });
  await page.goto(`/u/${token}`);
  const names = page.getByRole("group", { name: "Names on the envelope" });
  await expect(names).toContainText("First person");
  await expect(names.getByRole("textbox", { name: "Second person first name" })).toHaveValue(
    "Mark",
  );
  await expect(page.getByText(/your partner|your name/i)).toHaveCount(0);
  await expect(page.locator("#email")).toHaveValue("mark@holloway.test");
});
