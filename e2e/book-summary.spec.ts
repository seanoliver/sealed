import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedEmailSend,
} from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("summary-owner");
const address = {
  addressLine1: "1 Main St",
  city: "Portland",
  stateRegion: "OR",
  postalCode: "97201",
  countryCode: "US",
};
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signupAndLogin(page, ownerEmail);
  const bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("summary-book"),
    displayName: "Summary Owner",
  });
  await seedContact({ bookId, fullName: "Ann Addressed", email: "ann@e2e.test", ...address });
  await seedContact({ bookId, fullName: "Nell Noaddress", email: "nell@e2e.test" });
  await seedContact({ bookId, fullName: "Hal Handwritten", ...address });
  await seedContact({ bookId, fullName: "Zed Nothing" });
  const bounced = await seedContact({ bookId, fullName: "Bo Bounce", email: "bo@e2e.test" });
  await seedEmailSend({
    contactId: bounced,
    bookId,
    resendId: `re_summary_${Date.now()}`,
    status: "bounced",
  });
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await page.close();
});

const summary = () => page.getByRole("region", { name: "Book summary" });
const rows = () => page.getByRole("table", { name: "Contacts" }).locator("tbody tr");
const count = (name: string | RegExp) => summary().getByRole("button", { name });

test("the card counts the book by route and status", async () => {
  await page.goto("/dashboard");
  await expect(summary()).toContainText("5 contacts");
  await expect(summary()).toContainText("5 envelopes: 2 with an address, 3 without");
  await expect(count(/^To email/)).toContainText("3");
  await expect(count(/^Ask manually/)).toContainText("2");
  await expect(count(/^Bounced/)).toContainText("1");
  await expect(summary()).toContainText("1 already has an address.");
});

test("a count filters the table and tapping it again clears", async () => {
  await page.goto("/dashboard");
  const filter = count("No mailing address (3)");
  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(rows()).toHaveCount(3);
  await expect(page.getByText("Showing 3 with no mailing address")).toBeVisible();
  await filter.click();
  await expect(rows()).toHaveCount(5);
});

test("a status count applies to its route only", async () => {
  await page.goto("/dashboard");
  await count(/^Not sent/).nth(0).click();
  await expect(rows()).toHaveCount(2);
  await expect(rows().filter({ hasText: "Ann Addressed" })).toHaveCount(1);
  await count(/^Not sent/).nth(1).click();
  await expect(rows()).toHaveCount(2);
  await expect(rows().filter({ hasText: "Zed Nothing" })).toHaveCount(1);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(rows()).toHaveCount(5);
});

test("Send to all shown reports the no-email rows as skipped", async () => {
  await page.goto("/dashboard");
  await count("No mailing address (3)").click();
  await page.getByRole("button", { name: "Send to all shown" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm address request" });
  await expect(dialog).toContainText("the 2 contacts shown");
  await expect(dialog).toContainText("1 will be skipped: no email");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("search does not change the counts", async () => {
  await page.goto("/dashboard?q=Zed");
  await expect(rows()).toHaveCount(1);
  await expect(summary()).toContainText("5 contacts");
  await expect(summary()).toContainText("Whole book, not this search.");
  await count("No mailing address (3)").click();
  await expect(page.getByText("Showing 1 with no mailing address")).toBeVisible();
});

test("Hide collapses the card and is remembered", async () => {
  await page.goto("/dashboard");
  await summary().getByRole("button", { name: "Hide" }).click();
  await expect(summary()).toContainText("3 to email · 2 ask manually");
  await page.reload();
  await summary().getByRole("button", { name: "Show" }).click();
  await expect(count(/^To email/)).toBeVisible();
});
