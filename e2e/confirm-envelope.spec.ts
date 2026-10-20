import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  clearRateLimits,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedEmailSend,
  seedUpdateToken,
} from "./db";
import {
  signupAndLogin,
  stubTurnstile,
  uniqueEmail,
  uniqueSlug,
  waitForTurnstile,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("confirm-owner");
let ownerPage: Page;
let token: string;
let noAddressToken: string;
let fixToken: string;
let dropToken: string;

test.beforeAll(async ({ browser }) => {
  await clearRateLimits();
  ownerPage = await browser.newPage();
  await signupAndLogin(ownerPage, ownerEmail);
  const bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("confirm-book"),
    displayName: "Confirm Owner",
    enabledFields: { partner_name: false, kids_names: false, birthday: false },
  });
  const contactId = await seedContact({
    bookId,
    fullName: "Cora Confirm",
    email: "cora@e2e.test",
    partnerName: "Hidden Partner",
    addressLine1: "1428 Alder St",
    city: "Portland",
    stateRegion: "OR",
    postalCode: "97214",
  });
  await seedEmailSend({
    contactId,
    bookId,
    resendId: `e2e_confirm_${Date.now().toString(36)}`,
  });
  token = await seedUpdateToken(contactId);
  fixToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Finn Fix",
      email: "finn@e2e.test",
      addressLine1: "9 Elm St",
    }),
  );
  dropToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Dee Drop",
      email: "dee@e2e.test",
      addressLine1: "3 Oak Ave",
    }),
  );
  noAddressToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Satya & Family",
      email: "satya@e2e.test",
    }),
  );
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await ownerPage.close();
});

test("a recipient confirms the envelope in one tap", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await stubTurnstile(page);
  await page.goto(`/u/${token}/confirm`);

  await expect(
    page.getByRole("heading", {
      name: "Send Confirm Owner's card to this envelope?",
    }),
  ).toBeVisible();
  const envelope = page.locator("address");
  await expect(envelope).toHaveText(
    "Cora Confirm1428 Alder StPORTLAND, OR 97214",
  );
  expect(await page.content()).not.toContain("Hidden Partner");

  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Yes, send it here" }).click();
  await expect(
    page.getByRole("heading", { name: "You're on the list" }),
  ).toBeVisible();

  await page.goto(`/u/${token}/confirm`);
  await expect(
    page.getByRole("heading", { name: "You're already on the list" }),
  ).toBeVisible();
  await context.close();

  await ownerPage.goto("/dashboard");
  const row = ownerPage
    .getByRole("table", { name: "Contacts" })
    .locator("tbody tr", { hasText: "Cora Confirm" });
  await expect(row).toContainText("Updated");
});

test("a dropped connection asks for another tap", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${dropToken}/confirm`);
  await waitForTurnstile(page);
  let dropped = false;
  await page.route(`**/u/${dropToken}/confirm`, (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      return route.abort("internetdisconnected");
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "Yes, send it here" }).click();
  await expect(
    page.getByText("The connection dropped. Tap again."),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __ts: { solve: () => void } }).__ts.solve(),
  );
  await page.getByRole("button", { name: "Yes, send it here" }).click();
  await expect(
    page.getByRole("heading", { name: "You're on the list" }),
  ).toBeVisible();
});

test("the button waits for the bot check", async ({ page }) => {
  await stubTurnstile(page, { pending: true });
  await page.goto(`/u/${fixToken}/confirm`);
  await page.waitForFunction(() => "__ts" in window);
  await expect(
    page.getByRole("button", { name: "Checking you're human…" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (window as unknown as { __ts: { solve: () => void } }).__ts.solve(),
  );
  await expect(
    page.getByRole("button", { name: "Yes, send it here" }),
  ).toBeEnabled();
});

test("a failed bot check keeps the button disabled until a retry solves it", async ({ page }) => {
  await stubTurnstile(page, { failChallenge: true });
  await page.goto(`/u/${fixToken}/confirm`);
  await page.waitForFunction(() => "__ts" in window);
  await expect(
    page.getByRole("button", { name: "Yes, send it here" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "verification check didn’t load" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __ts: { solve: () => void } }).__ts.solve(),
  );
  await expect(
    page.getByRole("button", { name: "Yes, send it here" }),
  ).toBeEnabled();
});

test("the fix link opens the full form", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${fixToken}/confirm`);
  await page.getByRole("link", { name: "Fix a name or the address" }).click();
  await expect(page).toHaveURL(new RegExp(`/u/${fixToken}$`));
  await expect(
    page.getByRole("button", { name: "Update my details" }),
  ).toBeVisible();
});

test("a contact with no address goes straight to the form", async ({
  page,
}) => {
  await stubTurnstile(page);
  await page.goto(`/u/${noAddressToken}/confirm`);
  await expect(page).toHaveURL(new RegExp(`/u/${noAddressToken}$`));
  await expect(
    page.getByRole("button", { name: "Update my details" }),
  ).toBeVisible();
});

test("unknown and malformed tokens get the generic page on /confirm", async ({
  page,
}) => {
  await page.goto("/u/not-a-real-token/confirm");
  await expect(
    page.getByRole("heading", { name: "Link not available" }),
  ).toBeVisible();
  await page.goto(`/u/${"A".repeat(43)}/confirm`);
  await expect(
    page.getByRole("heading", { name: "Link not available" }),
  ).toBeVisible();
});
