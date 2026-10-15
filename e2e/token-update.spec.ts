import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  clearRateLimits,
  generateToken,
  getContactNamesByEmail,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedEmailSend,
  seedOwnerBook,
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
  // A legacy contact: the stored display strings are split into a guess.
  await expect(page.locator("#first_name")).toHaveValue("Tess");
  await expect(page.locator("#last_name")).toHaveValue("Token");
  await expect(page.locator("#partner_first")).toHaveValue("Pat");
  await expect(page.locator("#partner_last")).toHaveValue("Partner");
  await expect(page.locator("#city")).toHaveValue("Lisbon");
  // kids_names is disabled for this book: no kids rows or add button...
  await expect(page.locator("#kid_0_first")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a child" })).toHaveCount(0);
  // ...and its stored value must not appear ANYWHERE (RSC payload included —
  // see docs/bugs/2026-07-11-rsc-props-leak-disabled-token-fields.md).
  const html = await page.content();
  expect(html).not.toContain("Zoe");
  expect(html).not.toContain("kids_section");

  await context.close();
});

test("recipient submits an update; owner sees the Updated chip and new values", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/u/${token}`);

  await page.locator("#city").fill("Porto");
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Update my details" }).click();
  await expect(page).toHaveURL(/\/u\/thanks$/);
  await expect(
    page.getByRole("heading", { name: /Thanks — you're all set!/ }),
  ).toBeVisible();
  await context.close();

  await ownerPage.goto("/dashboard");
  const row = ownerPage
    .getByRole("table", { name: "Contacts" })
    .locator("tbody tr", { hasText: "Tess Token" });
  await expect(row).toContainText("Updated"); // outranks the raw send status
  await expect(row).toContainText("Porto");

  // Submitting stored the split names; the disabled kids are untouched.
  const names = await getContactNamesByEmail("tess@e2e.test");
  expect(names).toMatchObject({
    firstName: "Tess",
    lastName: "Token",
    partnerFirstName: "Pat",
    partnerLastName: "Partner",
    kidsNames: "Zoe, Max",
    kids: null,
  });

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
  await expect(page.locator("#first_name")).toHaveCount(0);
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

test.describe("with partner and kids enabled", () => {
  const kidsOwnerEmail = uniqueEmail("token-kids-owner");
  const recipientEmail = uniqueEmail("token-kids-recipient");
  let kidsTokens: string[];

  test.beforeAll(async () => {
    const { bookId } = await seedOwnerBook({
      email: kidsOwnerEmail,
      displayName: "Kid Owner",
      slug: uniqueSlug("token-kids"),
    });
    const contactId = await seedContact({
      bookId,
      fullName: "Jen Holloway",
      email: recipientEmail,
      partnerName: "Mark",
      kidsNames: "Zoe, Max",
    });
    kidsTokens = [
      await seedUpdateToken(contactId),
      await seedUpdateToken(contactId),
    ];
  });

  test.afterAll(async () => {
    await cleanupUser(kidsOwnerEmail);
  });

  test("a recipient splits a legacy household and edits the kids", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/u/${kidsTokens[0]}`);

    await expect(page.locator("#first_name")).toHaveValue("Jen");
    await expect(page.locator("#last_name")).toHaveValue("Holloway");
    // A one-word partner and the kids follow the contact's last name.
    await expect(page.locator("#partner_first")).toHaveValue("Mark");
    await expect(page.locator("#partner_last")).toHaveValue("Holloway");
    await expect(page.locator("#kid_0_first")).toHaveValue("Zoe");
    await expect(page.locator("#kid_1_first")).toHaveValue("Max");
    await expect(page.locator("#kid_1_last")).toHaveValue("Holloway");

    await page.getByRole("button", { name: "Remove child 2" }).click();
    await page.getByRole("button", { name: "Add a child" }).click();
    await page.locator("#kid_1_first").fill("Ivy");

    // The recipient's own last name is required, with the owner's name.
    await page.locator("#last_name").fill("");
    await waitForTurnstile(page);
    await page.getByRole("button", { name: "Update my details" }).click();
    await expect(
      page.getByText("Add your last name so Kid Owner can address your mail."),
    ).toBeVisible();
    await expect(page.locator("#kid_1_first")).toHaveValue("Ivy");

    await page.locator("#last_name").fill("Holloway");
    await waitForTurnstile(page);
    await page.getByRole("button", { name: "Update my details" }).click();
    await expect(page).toHaveURL(/\/u\/thanks$/);
    await context.close();

    expect(await getContactNamesByEmail(recipientEmail)).toMatchObject({
      fullName: "Jen Holloway",
      partnerName: "Mark Holloway",
      kidsNames: "Zoe, Ivy",
      kids: [
        { first: "Zoe", last: "Holloway" },
        { first: "Ivy", last: "Holloway" },
      ],
    });
  });

  test("removing the partner and every kid clears them", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/u/${kidsTokens[1]}`);

    await expect(page.locator("#kid_1_first")).toHaveValue("Ivy");
    await page.getByRole("button", { name: "Remove partner" }).click();
    await page.getByRole("button", { name: "Remove child 2" }).click();
    await page.getByRole("button", { name: "Remove child 1" }).click();
    await waitForTurnstile(page);
    await page.getByRole("button", { name: "Update my details" }).click();
    await expect(page).toHaveURL(/\/u\/thanks$/);
    await context.close();

    expect(await getContactNamesByEmail(recipientEmail)).toMatchObject({
      fullName: "Jen Holloway",
      partnerName: null,
      partnerFirstName: null,
      kidsNames: null,
      kids: null,
    });
  });
});
