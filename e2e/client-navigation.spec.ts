import { expect, test, type Page } from "@playwright/test";
import { cleanupUser, getUserIdByEmail, seedBook, seedContact } from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("spa-owner");

let page: Page;

declare global {
  interface Window {
    __spaMarker?: number;
  }
}

async function expectNoFullReload(): Promise<void> {
  expect(await page.evaluate(() => window.__spaMarker)).toBe(1);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signupAndLogin(page, ownerEmail);
  const ownerId = await getUserIdByEmail(ownerEmail);
  const bookId = await seedBook({
    ownerId,
    slug: uniqueSlug("spa-book"),
    displayName: "Spa Owner",
  });
  await seedContact({ bookId, fullName: "Ada Lovelace" });
  const graceId = await seedContact({ bookId, fullName: "Grace Hopper" });
  // Compile every visited route up front; a cold dev compile outlasts toHaveURL.
  for (const route of [
    "/dashboard",
    `/dashboard/contacts/${graceId}`,
    "/dashboard/review",
    "/dashboard/import",
    "/dashboard/settings",
  ]) {
    await page.request.get(route);
  }
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await page.close();
});

test("search, back/forward and in-app links never reload the document", async () => {
  await page.goto("/dashboard");
  const table = page.getByRole("table", { name: "Contacts" });
  await expect(table.getByRole("link", { name: "Ada Lovelace" })).toBeVisible();
  await page.evaluate(() => {
    window.__spaMarker = 1;
  });

  const search = page.getByLabel("Search contacts");
  await search.fill("grace");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/dashboard\?q=grace$/);
  await expect(table.getByRole("link", { name: "Grace Hopper" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Ada Lovelace" })).toHaveCount(0);
  await expectNoFullReload();

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(table.getByRole("link", { name: "Ada Lovelace" })).toBeVisible();
  await expect(search).toHaveValue("");
  await expectNoFullReload();

  await page.goForward();
  await expect(page).toHaveURL(/\/dashboard\?q=grace$/);
  await expect(search).toHaveValue("grace");
  await expect(table.getByRole("link", { name: "Ada Lovelace" })).toHaveCount(0);
  await expectNoFullReload();

  await search.fill("ada");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/dashboard\?q=ada$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\?q=grace$/);
  await expect(search).toHaveValue("grace");
  await expectNoFullReload();

  await table.getByRole("link", { name: "Grace Hopper" }).click();
  await expect(page).toHaveURL(/\/dashboard\/contacts\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Grace Hopper" })).toBeVisible();
  await expectNoFullReload();

  const nav = page.getByRole("navigation");
  await nav.getByRole("link", { name: "Contacts" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expectNoFullReload();

  await nav.getByRole("link", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/dashboard\/review$/);
  await expect(page.getByRole("heading", { name: "Review submissions" })).toBeVisible();
  await expectNoFullReload();

  await nav.getByRole("link", { name: "Contacts" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "Import CSV" }).click();
  await expect(page).toHaveURL(/\/dashboard\/import$/);
  await expect(
    page.getByRole("heading", { name: "Import contacts from CSV" }),
  ).toBeVisible();
  await expectNoFullReload();

  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/dashboard\/settings$/);
  await expect(
    page.getByRole("heading", { name: "Address book settings" }),
  ).toBeVisible();
  await expectNoFullReload();

  await nav.getByRole("link", { name: "Contacts" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Your address book" })).toBeVisible();
  await expect(search).toHaveValue("");
  await expectNoFullReload();
});

test("a search closes an open send confirmation", async () => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Send to all shown" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("the 2 contacts shown");

  await page.getByLabel("Search contacts").fill("grace");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/dashboard\?q=grace$/);
  await expect(dialog).toHaveCount(0);
});
