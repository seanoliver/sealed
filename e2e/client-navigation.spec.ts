import { expect, test, type Page } from "@playwright/test";
import { cleanupUser, getUserIdByEmail, seedBook, seedContact } from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

/**
 * Signed-in navigation stays client-side (issue #36). A marker set on
 * `window` only survives while the document does, so it disappearing means
 * something fell back to a full page load.
 */
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
  await seedContact({ bookId, fullName: "Grace Hopper" });
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

  // Search: GET to /dashboard?q=… via client-side navigation.
  const search = page.getByLabel("Search contacts");
  await search.fill("grace");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/dashboard\?q=grace$/);
  await expect(table.getByRole("link", { name: "Grace Hopper" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Ada Lovelace" })).toHaveCount(0);
  await expectNoFullReload();

  // Back restores the unfiltered list and empties the search box.
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(table.getByRole("link", { name: "Ada Lovelace" })).toBeVisible();
  await expect(search).toHaveValue("");
  await expectNoFullReload();

  // Forward restores the query in both the URL and the search box.
  await page.goForward();
  await expect(page).toHaveURL(/\/dashboard\?q=grace$/);
  await expect(search).toHaveValue("grace");
  await expect(table.getByRole("link", { name: "Ada Lovelace" })).toHaveCount(0);
  await expectNoFullReload();

  // Open a contact from the table.
  await table.getByRole("link", { name: "Grace Hopper" }).click();
  await expect(page).toHaveURL(/\/dashboard\/contacts\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Grace Hopper" })).toBeVisible();
  await expectNoFullReload();

  // dashboard → review → import → settings → dashboard via in-app links.
  const nav = page.getByRole("navigation");
  await nav.getByRole("link", { name: "Contacts" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expectNoFullReload();

  await nav.getByRole("link", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/dashboard\/review$/);
  await expect(page.getByRole("heading", { name: "Review submissions" })).toBeVisible();
  await expectNoFullReload();

  // Import is reached from the dashboard header, not the nav.
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
