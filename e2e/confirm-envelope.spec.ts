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
let coupleToken: string;
let guardToken: string;
let lostToken: string;

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
  const coupleId = await seedContact({
    bookId,
    fullName: "Cleo Couple",
    email: "cleo@e2e.test",
    partnerEmail: "cal@e2e.test",
    addressLine1: "5 Birch Rd",
    city: "Portland",
    stateRegion: "OR",
    postalCode: "97214",
  });
  for (const recipient of ["primary", "partner"] as const) {
    await seedEmailSend({
      contactId: coupleId,
      bookId,
      recipient,
      resendId: `e2e_confirm_${recipient}_${Date.now().toString(36)}`,
    });
  }
  coupleToken = await seedUpdateToken(coupleId);
  guardToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Gia Guard",
      email: "gia@e2e.test",
      addressLine1: "4 Pine Ct",
    }),
  );
  lostToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Lu Lost",
      email: "lu@e2e.test",
      addressLine1: "8 Fir Ln",
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

test.beforeEach(clearRateLimits);

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
    "Cora Confirm1428 Alder StPortland, OR 97214",
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
  await expect(row).toContainText("Confirmed"); // a reply that changed nothing
});

test("a couple's row shows one Confirmed chip, not a chip per person", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${coupleToken}/confirm`);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Yes, send it here" }).click();
  await expect(page.getByRole("heading", { name: "You're on the list" })).toBeVisible();

  await ownerPage.goto("/dashboard");
  const row = ownerPage
    .getByRole("table", { name: "Contacts" })
    .locator("tbody tr", { hasText: "Cleo Couple" });
  await expect(row).toContainText("Confirmed");
  await expect(row).not.toContainText("· Sent");
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
  await page.getByRole("button", { name: /^Email:/ }).click();
  const details = page.getByRole("dialog", { name: "Email" });
  await details.locator("#email").fill("dee.new@e2e.test");
  await details.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(
    page.getByText("The connection dropped. Tap again."),
  ).toBeVisible();
  await expect(page.locator("#email")).toHaveValue("dee.new@e2e.test");
  await page.evaluate(() =>
    (window as unknown as { __ts: { solve: () => void } }).__ts.solve(),
  );
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(
    page.getByRole("heading", { name: "You're on the list" }),
  ).toBeVisible();
});

test("a retry after a lost save response says the link is used and keeps the edits", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${lostToken}/confirm`);
  await waitForTurnstile(page);
  let lost = false;
  await page.route(`**/u/${lostToken}/confirm`, async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch();
      return route.abort("internetdisconnected");
    }
    return route.continue();
  });
  await page.getByRole("button", { name: /^Email:/ }).click();
  const details = page.getByRole("dialog", { name: "Email" });
  await details.locator("#email").fill("lu.new@e2e.test");
  await details.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(page.getByText("The connection dropped. Tap again.")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __ts: { solve: () => void } }).__ts.solve(),
  );
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(page.getByText("This link is invalid or has expired.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You're on the list" })).toBeHidden();
  await expect(page.locator("#email")).toHaveValue("lu.new@e2e.test");
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

test("the full form is still one link away", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${fixToken}/confirm`);
  await page.getByRole("button", { name: /^9 Elm St\. Edit/ }).click();
  await page.getByRole("link", { name: "Use the full form instead" }).click();
  await expect(page).toHaveURL(new RegExp(`/u/${fixToken}$`));
  await expect(
    page.getByRole("button", { name: "Update my details" }),
  ).toBeVisible();
});

test("tapping a line edits just that line, and sending saves the changes", async ({
  page,
}) => {
  await stubTurnstile(page);
  await page.goto(`/u/${fixToken}/confirm`);
  await waitForTurnstile(page);
  await expect(
    page.getByRole("button", { name: "+ Add city, state and ZIP code" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes, send it here" })).toBeEnabled();

  await page.getByRole("button", { name: /^9 Elm St\. Edit/ }).click();
  const sheet = page.getByRole("dialog", { name: "Street address" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("#city")).toBeHidden();
  await sheet.locator("#address_line1").fill("11 Elm St");
  await expect(page.locator("address")).toContainText("11 Elm St");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();

  await page.getByRole("button", { name: "+ Add city, state and ZIP code" }).click();
  const city = page.getByRole("dialog", { name: "City, state and ZIP code" });
  await city.locator("#city").fill("Portland");
  await city.locator("#state_region").selectOption("OR");
  await city.locator("#postal_code").fill("972");
  await city.getByRole("button", { name: "Done" }).click();
  await expect(city.locator("#postal_code-error")).toBeVisible();
  await city.locator("#postal_code").fill("97214");
  await city.getByRole("button", { name: "Done" }).click();
  await expect(city).toBeHidden();

  await page.getByRole("button", { name: "Send it here · 2 changes" }).click();
  await expect(
    page.getByRole("heading", { name: "You're on the list" }),
  ).toBeVisible();
  await expect(page.locator("address")).toHaveText("Finn Fix11 Elm StPortland, OR 97214");

  await ownerPage.goto("/dashboard");
  const row = ownerPage
    .getByRole("table", { name: "Contacts" })
    .locator("tbody tr", { hasText: "Finn Fix" });
  await expect(row).toContainText("11 Elm St");
});

test("a bad postcode keeps earlier edits and sends the recipient back to it", async ({
  page,
}) => {
  await stubTurnstile(page);
  await page.goto(`/u/${guardToken}/confirm`);
  await waitForTurnstile(page);

  await page.getByRole("button", { name: /^Gia Guard\. Edit/ }).click();
  const names = page.getByRole("dialog", { name: "Names on the envelope" });
  await names.locator("#last_name").fill("Guardian");
  await names.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "+ Add city, state and ZIP code" }).click();
  const city = page.getByRole("dialog", { name: "City, state and ZIP code" });
  await city.locator("#city").fill("Portland");
  await city.locator("#state_region").selectOption("OR");
  await city.locator("#postal_code").fill("972");
  await city.getByRole("button", { name: "Done" }).click();
  await expect(city.locator("#postal_code-error")).toBeVisible();
  await expect(page.locator("address")).toContainText("Gia Guardian");
  await expect(city.locator("#postal_code")).toHaveValue("972");
  await expect(page.locator(".shake-x")).toHaveCount(0);
  await city.getByRole("button", { name: "Done" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Gia Guardian\. Edit/ }).click();
  expect(await page.locator(".shake-x").count()).toBe(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Portland, OR 972\. Edit/ }).click();

  await page.keyboard.press("Escape");
  await expect(city).toBeHidden();
  await page.getByRole("button", { name: /^Send it here/ }).click();
  await expect(city).toBeVisible();
  await expect(city.locator("#postal_code")).toBeFocused();

  await city.locator("#postal_code").fill("97214");
  await city.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /^Send it here/ }).click();
  await expect(page.getByRole("heading", { name: "You're on the list" })).toBeVisible();
  await expect(page.locator("address")).toContainText("Gia Guardian");
});

test("a contact with no address adds one line by line", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${noAddressToken}/confirm`);
  await waitForTurnstile(page);
  await expect(page).toHaveURL(new RegExp(`/u/${noAddressToken}/confirm$`));
  await expect(
    page.getByRole("button", { name: "Add your address to continue" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "+ Add street address" }).click();
  const street = page.getByRole("dialog", { name: "Street address" });
  await expect(street.getByText("1 of 2")).toBeVisible();
  await street.locator("#address_line1").fill("1550 Larkin St");
  await street.getByRole("button", { name: "Next" }).click();
  const city = page.getByRole("dialog", { name: "City, state and ZIP code" });
  await expect(city.getByText("2 of 2")).toBeVisible();
  await city.locator("#city").fill("San Francisco");
  await city.locator("#state_region").selectOption("CA");
  await city.locator("#postal_code").fill("94109");
  await city.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: /^Send it here/ }).click();
  const names = page.getByRole("dialog", { name: "Names on the envelope" });
  await expect(names).toBeVisible();
  await names.locator("#last_name").fill("Rao");
  await names.getByRole("button", { name: "Done" }).click();
  await page.evaluate(() =>
    (window as unknown as { __ts: { solve: () => void } }).__ts.solve(),
  );
  await page.getByRole("button", { name: /^Send it here/ }).click();
  await expect(
    page.getByRole("heading", { name: "You're on the list" }),
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
