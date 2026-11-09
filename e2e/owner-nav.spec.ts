import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  clearRateLimits,
  getUserIdByEmail,
  rejectPendingSubmissions,
  seedBook,
  seedContact,
  seedPermalinkSubmission,
} from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("nav-owner");
const screenshotDir = process.env.OWNER_NAV_SCREENSHOT_DIR;

let page: Page;
let bookId: string;

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function shoot(name: string, { dark = false }: { dark?: boolean } = {}) {
  if (!screenshotDir) return;
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await page.mouse.move(1, 700); // no stray hover shading in the capture
  await page.waitForTimeout(400); // let fades and transition-colors settle
  await page.screenshot({ path: `${screenshotDir}/${name}.png` });
}

const menuButton = () => page.getByRole("button", { name: "Menu" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await clearRateLimits();
  page = await browser.newPage({ viewport: PHONE });
  await signupAndLogin(page, ownerEmail);
  const ownerId = await getUserIdByEmail(ownerEmail);
  bookId = await seedBook({ ownerId, slug: uniqueSlug("nav-book"), displayName: "Nav Owner" });
  for (const [fullName, city] of [
    ["Elena Rossi", "San Francisco"],
    ["Grandma June", "Asheville"],
    ["Hana Sato", "Tokyo"],
    ["Maya Chen", "Seattle"],
  ]) {
    await seedContact({ bookId, fullName, city, addressLine1: "1 Main St" });
  }
  await seedPermalinkSubmission({ bookId, payload: { full_name: "Elena Rossi", city: "Oakland" } });
  await seedPermalinkSubmission({ bookId, payload: { full_name: "Hana Sato", city: "Kyoto" } });
  // Compile every visited route up front; a cold dev compile outlasts toHaveURL.
  for (const route of ["/dashboard", "/dashboard/review", "/dashboard/agents", "/dashboard/settings"]) {
    await page.request.get(route);
  }
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await page.close();
});

test("phone header is one row with a menu button and a review dot", async () => {
  await page.setViewportSize(PHONE);
  await page.goto("/dashboard");
  const header = page.locator("header").first();
  const box = await header.boundingBox();
  expect(box?.height).toBeLessThan(70);

  await expect(menuButton()).toBeVisible();
  await expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("review-dot")).toBeVisible();
  await expect(page.getByRole("link", { name: "Agents" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
  await shoot("phone-closed-light");
});

test("menu opens a sheet with the current page marked, and Escape closes it", async () => {
  await menuButton().click();
  await expect(menuButton()).toHaveAttribute("aria-expanded", "true");
  const sheetId = await menuButton().getAttribute("aria-controls");
  expect(sheetId).toBeTruthy();
  const panel = page.locator(`[id="${sheetId}"]`);
  await expect(panel).toBeVisible();

  for (const name of ["Contacts", "Review", "Agents", "Settings"]) {
    await expect(panel.getByRole("link", { name })).toBeVisible();
  }
  await expect(panel.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Contacts" })).toHaveAttribute("aria-current", "page");
  await expect(panel.getByRole("link", { name: "Review" })).not.toHaveAttribute("aria-current", "page");
  await expect(panel.getByRole("link", { name: "Review" })).toContainText("2");
  await expect(page.getByTestId("review-dot")).toHaveCount(0);
  await expect(panel.getByRole("link", { name: "Contacts" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  await shoot("phone-open-count-light");
  await shoot("phone-open-count-dark", { dark: true });
  await page.emulateMedia({ colorScheme: "light" });

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  await expect(menuButton()).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
});

test("choosing a link navigates and closes the menu; scrim and X close it too", async () => {
  await menuButton().click();
  const sheetId = await menuButton().getAttribute("aria-controls");
  const panel = page.locator(`[id="${sheetId}"]`);
  await panel.getByRole("link", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/dashboard\/review$/);
  await expect(panel).toHaveCount(0);
  await expect(menuButton()).toHaveAttribute("aria-expanded", "false");

  await menuButton().click();
  await expect(panel.getByRole("link", { name: "Review" })).toHaveAttribute("aria-current", "page");
  await menuButton().click();
  await expect(panel).toHaveCount(0);

  await menuButton().click();
  await expect(panel).toBeVisible();
  await page.mouse.click(PHONE.width / 2, PHONE.height - 40);
  await expect(panel).toHaveCount(0);
  await expect(menuButton()).toBeFocused();
});

test("back navigation, Tab and widening the window keep the menu consistent", async () => {
  await page.goto("/dashboard");
  const sheetId = await menuButton().getAttribute("aria-controls");
  const panel = page.locator(`[id="${sheetId}"]`);
  await menuButton().click();
  await panel.getByRole("link", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/dashboard\/review$/);
  await menuButton().click();
  await expect(panel).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(panel).toHaveCount(0);

  await menuButton().click();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      (id) => {
        const active = document.activeElement;
        const button = document.querySelector(`[aria-controls="${id}"]`);
        return active === button || !!document.getElementById(id as string)?.contains(active);
      },
      sheetId,
    );
    expect(inside).toBe(true);
  }

  await page.setViewportSize(DESKTOP);
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  await page.setViewportSize(PHONE);
});

test("empty review queue shows no dot and no count", async () => {
  await rejectPendingSubmissions(bookId);
  await page.goto("/dashboard");
  await expect(menuButton()).toBeVisible();
  await expect(page.getByTestId("review-dot")).toHaveCount(0);
  await menuButton().click();
  const sheetId = await menuButton().getAttribute("aria-controls");
  const panel = page.locator(`[id="${sheetId}"]`);
  await expect(panel.getByRole("link", { name: "Review" })).toHaveText("Review");
  await shoot("phone-open-empty-light");
  await page.keyboard.press("Escape");
});

test("the dashboard footer credits the maker", async () => {
  await page.goto("/dashboard");
  await expect(page.locator("footer").getByRole("link", { name: "Sean Oliver" })).toHaveAttribute(
    "href",
    "https://seanoliver.dev/",
  );
});

test("desktop keeps the single row of links with no menu button", async () => {
  await seedPermalinkSubmission({ bookId, payload: { full_name: "Maya Chen", city: "Portland" } });
  await page.setViewportSize(DESKTOP);
  await page.goto("/dashboard");
  const nav = page.locator("header nav");
  for (const name of ["Contacts", "Review", "Agents", "Settings"]) {
    await expect(nav.getByRole("link", { name, exact: false }).first()).toBeVisible();
  }
  await expect(nav.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(menuButton()).toBeHidden();
  await expect(nav.getByRole("link", { name: /Review/ })).toContainText("1");
  const box = await page.locator("header").first().boundingBox();
  expect(box?.height).toBeLessThan(70);
  await shoot("desktop-light");
  await shoot("desktop-dark", { dark: true });
});
