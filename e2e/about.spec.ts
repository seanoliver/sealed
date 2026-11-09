import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedUpdateToken,
} from "./db";
import { signupAndLogin, stubTurnstile, uniqueEmail, uniqueSlug } from "./helpers";

const ownerEmail = uniqueEmail("about-owner");

async function waitForHydration(page: Page) {
  await page.waitForFunction(() =>
    Object.keys(document.querySelector("main") ?? {}).some((key) => key.startsWith("__reactFiber")),
  );
}
let token: string;
let slug: string;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signupAndLogin(page, ownerEmail);
  await page.close();
  const bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: (slug = uniqueSlug("about-book")),
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
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1, name: "What is Sealed?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who sees my address?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "hello@sealed.page" })).toHaveAttribute(
    "href",
    "mailto:hello@sealed.page",
  );
  await expect(page.getByRole("button", { name: "← Back" })).toHaveCount(0);
});

test("a recipient can open the about page and come back to their link", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${token}/confirm`);
  await page.waitForFunction(() => "__ts" in window);
  await expect(page.getByText("Only About Owner sees what you enter.")).toBeVisible();
  await page.getByRole("link", { name: "Sealed", exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page).toHaveURL(new RegExp(`/u/${token}/confirm$`));
});

test("recipient pages and the homepage link to the about page", async ({ page }) => {
  await stubTurnstile(page);
  for (const path of [`/u/${token}`, `/u/${token}/confirm`]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "Sealed", exact: true })).toHaveAttribute("href", "/about");
    await expect(page.getByRole("link", { name: "Sean Oliver" })).toHaveAttribute("href", "https://seanoliver.dev/");
  }
  for (const path of ["/", "/about"]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "Sean Oliver" })).toHaveAttribute("href", "https://seanoliver.dev/");
  }
  await expect(page.getByRole("link", { name: "What is this?" })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "What is this?" })).toHaveAttribute("href", "/about");
});

test("the public book page credits the maker and links to the about page", async ({ page }) => {
  await page.goto(`/b/${slug}`);
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "Sean Oliver" })).toHaveAttribute("href", "https://seanoliver.dev/");
  await expect(footer.getByRole("link", { name: "What is this?" })).toHaveAttribute("href", "/about");
});

test("a visitor from another site gets no Back button", async ({ page }) => {
  await page.goto("/about", { referer: "https://mail.example.com/" });
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1, name: "What is Sealed?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "← Back" })).toHaveCount(0);
});

test("the update form and the public book page explain themselves", async ({ page }) => {
  await stubTurnstile(page);
  for (const path of [`/u/${token}`, `/b/${slug}`]) {
    await page.goto(path);
    await page.getByText("Why am I getting this?").click();
    await expect(page.getByText("Only About Owner sees what you enter.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: path === `/b/${slug}` ? "What is this?" : "Sealed", exact: true }),
    ).toHaveAttribute("href", "/about");
  }
});

test("a full page load from another Sealed page shows Back", async ({ page, baseURL }) => {
  await page.goto("/about", { referer: `${baseURL}/u/${token}` });
  await expect(page.getByRole("button", { name: "← Back" })).toBeVisible();
});
