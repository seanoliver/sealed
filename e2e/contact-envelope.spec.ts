import { expect, test, type Page } from "@playwright/test";
import { cleanupUser, getContactAddress, getUserIdByEmail, seedBook, seedContact } from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

const ownerEmail = uniqueEmail("contact-envelope");
let bookId: string;
let page: Page;
let filledId: string;
let emptyId: string;
let phoneOnlyId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  test.setTimeout(120_000);
  await signupAndLogin(page, ownerEmail);
  bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("contact-envelope"),
    displayName: "Envelope Owner",
  });
  filledId = await seedContact({
    bookId,
    fullName: "Mei Lin",
    email: "mei@example.test",
    addressLine1: "412 Alder Street",
    city: "Portland",
    stateRegion: "OR",
    postalCode: "97214",
    countryCode: "US",
  });
  emptyId = await seedContact({ bookId, fullName: "Tomas Reyes", email: "tomas@example.test" });
  phoneOnlyId = await seedContact({ bookId, fullName: "Rosa Diaz", email: "rosa@example.test" });
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await page.close();
});

const back = () => page.getByRole("link", { name: "Contacts", exact: true }).first();

test("the way back stays on screen on a phone and keeps the list's search", async () => {
  await page.goto("/dashboard?q=Mei");
  await page.getByRole("link", { name: "Mei Lin" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/contacts/${filledId}$`));

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(back()).toBeInViewport();
  await back().click();
  await expect(page).toHaveURL(/\/dashboard\?q=Mei$/);
});

test("opened directly, the link goes to the last list search", async () => {
  await page.goto(`/dashboard/contacts/${filledId}`);
  await back().click();
  await expect(page).toHaveURL(/\/dashboard\?q=Mei$/);
});

test("a line opens in place and Save writes it with the rest of the form", async () => {
  await page.goto(`/dashboard/contacts/${filledId}`);
  await page.getByRole("button", { name: /Edit street address/i }).click();
  await page.locator("#address_line1").fill("500 Birch Avenue");
  await page.locator("#birthday").fill("1990-03-14");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("2 changes")).toBeInViewport();

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByText("2 changes")).toBeHidden();
  expect(await getContactAddress(filledId)).toMatchObject({ address_line1: "500 Birch Avenue" });
});

test("a contact with no address gets dashed slots and still saves", async () => {
  await page.goto(`/dashboard/contacts/${emptyId}`);
  await expect(page.getByRole("button", { name: /^\+ Add street address/i })).toBeVisible();
  await page.locator("#notes").fill("Met at the reunion");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
});

test("a partial address stays visible with no street", async () => {
  await page.goto(`/dashboard/contacts/${phoneOnlyId}`);
  await page.getByRole("button", { name: /Add city/ }).click();
  await page.locator("#city").fill("Tulsa");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByRole("button", { name: /^Tulsa\. Edit city/ })).toBeVisible();
});

test("Back asks before losing changes, and can save first", async () => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Mei Lin" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/contacts/${filledId}$`));
  await page.locator("#notes").fill("Keep this note");
  await expect(page.getByText("1 change")).toBeInViewport();

  await back().click();
  const dialog = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/dashboard/contacts/${filledId}$`));

  await back().click();
  await dialog.getByRole("button", { name: "Save and go back" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`/dashboard/contacts/${filledId}`);
  await expect(page.locator("#notes")).toHaveValue("Keep this note");
});

test("a bad postcode from the save button opens its line", async () => {
  await page.goto(`/dashboard/contacts/${filledId}`);
  await page.getByRole("button", { name: /Edit ZIP code|Edit city/i }).click();
  await page.locator("#postal_code").fill("9721");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#postal_code")).toBeVisible();
  await expect(page.getByText(/ZIP/).first()).toBeVisible();
});

test("opened in a new tab from the list, the link still goes to the list", async () => {
  const context = await page.context().browser()!.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
  });
  const tab = await context.newPage();
  await tab.goto(`/dashboard/contacts/${filledId}`, { referer: new URL("/dashboard", page.url()).href });
  await tab.getByRole("link", { name: "Contacts", exact: true }).first().click();
  await expect(tab).toHaveURL(/\/dashboard$/);
  await context.close();
});

test("a stored field the country doesn't print can still be cleared from the street line", async () => {
  const gbId = await seedContact({
    bookId,
    fullName: "Ada Byron",
    addressLine1: "10 Downing Street",
    city: "London",
    stateRegion: "Middlesex",
    postalCode: "SW1A 2AA",
    countryCode: "GB",
  });
  await page.goto(`/dashboard/contacts/${gbId}`);
  await page.getByRole("button", { name: /Edit street address/i }).click();
  await page.locator("#state_region").fill("");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  expect(await getContactAddress(gbId)).toMatchObject({ state_region: null });
});

test("editing the partner's personal email doesn't mark the names line", async () => {
  await page.goto(`/dashboard/contacts/${filledId}`);
  await page.locator("#partner_personal_email").fill("daniel@example.test");
  await expect(page.getByText("1 change")).toBeInViewport();
});

test("from an email link, Contacts still goes to the list after a swipe back", async () => {
  const context = await page.context().browser()!.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
  });
  const tab = await context.newPage();
  await tab.goto(`/dashboard/contacts/${filledId}`);
  await tab.getByRole("link", { name: "Contacts", exact: true }).first().click();
  await expect(tab).toHaveURL(/\/dashboard$/);
  await tab.goBack();
  await expect(tab).toHaveURL(new RegExp(`/dashboard/contacts/${filledId}$`));
  await tab.getByRole("link", { name: "Contacts", exact: true }).first().click();
  await expect(tab).toHaveURL(/\/dashboard$/);
  await context.close();
});

test("going back to the list returns to where it was scrolled", async () => {
  for (let i = 0; i < 30; i++) {
    await seedContact({ bookId, fullName: `Scroll Filler ${String(i).padStart(2, "0")}` });
  }
  await page.goto("/dashboard");
  const target = page.getByRole("link", { name: "Scroll Filler 25" }).first();
  await target.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(200);
  await target.click();
  await expect(page).toHaveURL(/\/dashboard\/contacts\//);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("link", { name: "Contacts", exact: true }).first().click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
});
