import { expect, test } from "@playwright/test";
import {
  cleanupUser,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedUpdateToken,
} from "./db";
import { signupAndLogin, stubTurnstile, uniqueEmail, uniqueSlug } from "./helpers";

const ownerEmail = uniqueEmail("about-owner");
let token: string;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signupAndLogin(page, ownerEmail);
  await page.close();
  const bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("about-book"),
    displayName: "About Owner",
  });
  token = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Ada About",
      email: "ada-about@e2e.test",
      addressLine1: "1428 Alder St",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
    }),
  );
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
});

test("the about page answers who sent this and who sees the address", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: "What is Sealed?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who sees my address?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "hello@sealed.page" })).toHaveAttribute(
    "href",
    "mailto:hello@sealed.page",
  );
  await expect(page.getByRole("button", { name: "← Back" })).toHaveCount(0);
});

test("a recipient can open the explainer and come back to their link", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${token}/confirm`);
  const explainer = page.getByText("Why am I getting this?");
  await explainer.click();
  await expect(page.getByText("Only About Owner sees what you enter.")).toBeVisible();
  await page.getByRole("link", { name: "More about Sealed →" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page).toHaveURL(new RegExp(`/u/${token}/confirm$`));
});

test("recipient pages and the homepage link to the about page", async ({ page }) => {
  await stubTurnstile(page);
  for (const path of [`/u/${token}`, `/u/${token}/confirm`, "/"]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "What is this?" })).toHaveAttribute("href", "/about");
  }
});
