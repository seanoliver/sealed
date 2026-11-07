import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedEmailSend,
} from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

/** States the main summary spec's book can't show: a failed send, an empty count, phones, blocked storage. */
test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("summary-states");
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signupAndLogin(page, ownerEmail);
  const bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("summary-states"),
    displayName: "States Owner",
  });
  await seedContact({
    bookId,
    fullName: "Ann Addressed",
    email: "ann@states.test",
    addressLine1: "1 Main St",
    city: "Portland",
    stateRegion: "OR",
    postalCode: "97201",
    countryCode: "US",
  });
  const failed = await seedContact({ bookId, fullName: "Fay Failed", email: "fay@states.test" });
  await seedEmailSend({
    contactId: failed,
    bookId,
    resendId: `re_states_${Date.now()}`,
    status: "failed",
    failureReason: "rejected",
  });
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await page.close();
});

const summary = () => page.getByRole("region", { name: "Book summary" });
const rows = () => page.getByRole("table", { name: "Contacts" }).locator("tbody tr");

test("a failed send has its own name, apart from the unsent count", async () => {
  await page.goto("/dashboard");
  await expect(summary().getByRole("button", { name: /^Send failed/ })).toContainText("1");
  await expect(summary().getByRole("button", { name: /^Not sent/ })).toContainText("1");
});

test("a count of zero can't be tapped", async () => {
  await page.goto("/dashboard");
  await expect(summary().getByRole("button", { name: "No email (0)" }).first()).toBeDisabled();
});

test("a row being edited stays in view when a filter leaves it out", async () => {
  await page.goto("/dashboard");
  await rows().filter({ hasText: "Ann Addressed" }).locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("table", { name: "Contacts" }).getByRole("textbox").first()).toBeVisible();
  await summary().getByRole("button", { name: "No mailing address (1)" }).first().click();
  await expect(rows()).toHaveCount(2);
  await expect(page.getByRole("table", { name: "Contacts" }).getByRole("textbox").first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("on a phone, a filter applies and scrolls the list up", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
  });
  const phone = await context.newPage();
  // A short filtered list can't scroll far, so record the call rather than measure pixels.
  await phone.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { scrollCalls: string[] }).scrollCalls = calls;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, ...args) {
      calls.push(this.getAttribute("aria-label") ?? "");
      return original.apply(this, args);
    };
  });
  await phone.goto("/dashboard");
  await phone.getByRole("region", { name: "Book summary" }).getByRole("button", { name: "No mailing address (1)" }).click();
  await expect(phone.getByText("Showing 1 with no mailing address")).toBeVisible();
  expect(await phone.evaluate(() => (window as unknown as { scrollCalls: string[] }).scrollCalls)).toContain(
    "Contact actions",
  );
  await context.close();
});

test("the card still renders when the browser blocks storage", async ({ browser }) => {
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const blocked = await context.newPage();
  await blocked.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
  });
  await blocked.goto("/dashboard");
  expect(await blocked.evaluate(() => {
    try {
      window.localStorage.getItem("x");
      return false;
    } catch {
      return true;
    }
  })).toBe(true);
  const card = blocked.getByRole("region", { name: "Book summary" });
  await expect(card).toContainText("2 contacts");
  // Server HTML stays on screen after a client crash; only a live page answers a click.
  await card.getByRole("button", { name: "Hide" }).click();
  await expect(card.getByRole("button", { name: "Show" })).toBeVisible();
  await context.close();
});
