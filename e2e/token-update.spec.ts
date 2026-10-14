import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  clearRateLimits,
  generateToken,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedEmailSend,
  seedUpdateToken,
} from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug, waitForTurnstile } from "./helpers";

/**
 * The /u/[token] recipient-update surface. The owner signs up through the
 * real UI; the book, contact, prior send, and token are seeded directly (the
 * raw token only ever exists in a dry-run email log, so the DB is the only
 * way a test can hold one). kids_names is DISABLED on this book to prove a
 * disabled field neither renders nor leaks its stored value.
 */
test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("token-owner");
const slug = uniqueSlug("token-book");

let ownerPage: Page;
let token: string;

test.beforeAll(async ({ browser }) => {
  // Token views/submits are IP-rate-limited; reset so repeated suite runs
  // never inherit a previous run's spent budget.
  await clearRateLimits();

  ownerPage = await browser.newPage();
  await signupAndLogin(ownerPage, ownerEmail);

  const ownerId = await getUserIdByEmail(ownerEmail);
  const bookId = await seedBook({
    ownerId,
    slug,
    displayName: "Token Owner",
    enabledFields: { partner_name: true, kids_names: true, birthday: true },
  });

  // Configure the personal update form through the real Settings surface.
  await ownerPage.goto("/dashboard/settings");
  await ownerPage.getByRole("switch", { name: "Kids' names" }).uncheck();
  await ownerPage.getByRole("button", { name: "Save" }).click();
  await expect(ownerPage.getByRole("status")).toHaveText("Saved.");

  const contactId = await seedContact({
    bookId,
    fullName: "Tess Token",
    email: "tess@e2e.test",
    partnerName: "Pat Partner",
    kidsNames: "Zoe, Max", // stored but disabled — must never reach the page
    city: "Lisbon",
    country: "Portugal",
  });
  // A prior "sent" row so a token update flips the dashboard chip to Updated
  // (the chip compares token events against the latest send).
  await seedEmailSend({
    contactId,
    bookId,
    resendId: `e2e_token_${Date.now().toString(36)}`,
  });
  token = await seedUpdateToken(contactId);
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await ownerPage.close();
});

test("prefills enabled fields; a disabled field is absent AND unleaked", async ({
  browser,
}) => {
  // Fresh context: recipient pages are unauthenticated by design.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/u/${token}`);

  await expect(
    page.getByRole("heading", { name: /Update your address for/ }),
  ).toBeVisible();
  await expect(page.locator("#full_name")).toHaveValue("Tess Token");
  await expect(page.locator("#partner_name")).toHaveValue("Pat Partner");
  await expect(page.locator("#city")).toHaveValue("Lisbon");
  // kids_names is disabled for this book: no input at all...
  await expect(page.locator("#kids_names")).toHaveCount(0);
  // ...and its stored value must not appear ANYWHERE (RSC payload included —
  // see docs/bugs/2026-07-11-rsc-props-leak-disabled-token-fields.md).
  expect(await page.content()).not.toContain("Zoe");

  await context.close();
});

test("recipient submits an update; owner sees the Updated chip and new values", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Platform request logs (Vercel) record every request path. The emailed
  // /u/<token> link may be logged once; every later request (the form page,
  // its RSC fetches, and the submit) must carry the token only in a cookie.
  const requestUrls: string[] = [];
  page.on("request", (req) => requestUrls.push(req.url()));
  await page.goto(`/u/${token}`);
  expect(page.url()).not.toContain(token);

  await page.locator("#city").fill("Porto");
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Update my details" }).click();
  await expect(page).toHaveURL(/\/u\/thanks$/);
  await expect(
    page.getByRole("heading", { name: /Thanks — you're all set!/ }),
  ).toBeVisible();
  const tokenRequests = requestUrls.filter((url) => url.includes(token));
  expect(tokenRequests.map((url) => new URL(url).pathname)).toEqual([
    `/u/${token}`,
  ]);
  // The submit itself went to the token-free form URL.
  expect(requestUrls.some((url) => new URL(url).pathname === "/u/edit")).toBe(
    true,
  );
  await context.close();

  await ownerPage.goto("/dashboard");
  const row = ownerPage
    .getByRole("table", { name: "Contacts" })
    .locator("tbody tr", { hasText: "Tess Token" });
  await expect(row).toContainText("Updated"); // outranks the raw send status
  await expect(row).toContainText("Porto");

  // The audit trail shows the recipient's change.
  await ownerPage.getByRole("link", { name: "Tess Token" }).click();
  const history = ownerPage.getByRole("region", { name: "History" });
  await expect(history.getByText("Recipient update")).toBeVisible();
  await expect(history.locator("pre").first()).toContainText("Porto");
});

test("a used link renders the generic invalid page", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/u/${token}`);
  await expect(
    page.getByRole("heading", { name: "Link not available" }),
  ).toBeVisible();
  await expect(page.locator("#full_name")).toHaveCount(0);
  await context.close();
});

test("unknown and malformed tokens render the same invalid page", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Well-formed but never minted.
  await page.goto(`/u/${generateToken().token}`);
  await expect(
    page.getByRole("heading", { name: "Link not available" }),
  ).toBeVisible();

  // Malformed (fails the shape gate before any DB work).
  await page.goto("/u/not-a-real-token");
  await expect(
    page.getByRole("heading", { name: "Link not available" }),
  ).toBeVisible();

  await context.close();
});
