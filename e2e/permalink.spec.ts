import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  cleanupUser,
  clearRateLimits,
  getContactNamesByEmail,
} from "./db";
import {
  createBook,
  signupAndLogin,
  uniqueEmail,
  uniqueSlug,
  waitForTurnstile,
} from "./helpers";

/**
 * The /b/[slug] public permalink surface: anonymous visitors submit the
 * write-only form; submissions land in the owner's review queue for
 * approve/reject. The owner and book are created through the real UI.
 */
test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("permalink-owner");
const slug = uniqueSlug("permalink");
const householdEmail = uniqueEmail("household");

let ownerPage: Page;

async function openInvitePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/b/${slug}`);
  return page;
}

async function expectThanks(page: Page): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/b/${slug}/thanks$`));
  await expect(
    page.getByRole("heading", { name: /Thanks — you're all set!/ }),
  ).toBeVisible();
}

/** Submit the public form as a brand-new anonymous visitor. */
async function submitAsVisitor(
  browser: Browser,
  fields: { first_name: string; last_name: string; email?: string; city?: string },
): Promise<void> {
  const page = await openInvitePage(browser);
  await expect(
    page.getByRole("heading", {
      name: "Add your address to Permalink Owner's address book",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Fill in your details below. Only Permalink Owner can see what you submit.",
    ),
  ).toBeVisible();
  // Write-only page: the form never pre-fills anything.
  await expect(page.locator("#first_name")).toHaveValue("");
  await expect(page.locator("#last_name")).toHaveValue("");

  await page.locator("#first_name").fill(fields.first_name);
  await page.locator("#last_name").fill(fields.last_name);
  if (fields.email) await page.locator("#email").fill(fields.email);
  if (fields.city) await page.locator("#city").fill(fields.city);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Add my details" }).click();
  await expectThanks(page);
  await page.context().close();
}

test.beforeAll(async ({ browser }) => {
  // Permalink submits are capped at 5/hour per IP — reset so repeated suite
  // runs from this machine never inherit a spent budget.
  await clearRateLimits();

  ownerPage = await browser.newPage();
  await signupAndLogin(ownerPage, ownerEmail);
  await createBook(ownerPage, {
    displayName: "Permalink Owner",
    slug,
    toggles: { partner_name: true, kids_names: true },
  });
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await ownerPage.close();
});

test("an unknown slug 404s", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.goto(`/b/${uniqueSlug("no-such-book")}`);
  expect(response?.status()).toBe(404);
  await context.close();
});

test("an anonymous visitor submits the write-only form", async ({ browser }) => {
  await submitAsVisitor(browser, {
    first_name: "Greta",
    last_name: "Approve",
    email: "greta@e2e.test",
    city: "Geneva",
  });
});

test("a second visitor submits (queued for the reject flow)", async ({
  browser,
}) => {
  await submitAsVisitor(browser, { first_name: "Rex", last_name: "Reject" });
});

test("the owner approves a submission into a contact", async () => {
  await ownerPage.goto("/dashboard/review");
  const card = ownerPage.locator("ol > li", { hasText: "Greta Approve" });
  await expect(card).toContainText("New contact");
  await expect(card).toContainText("Geneva");
  await card.getByRole("button", { name: "Add contact" }).click();
  await expect(card).toHaveCount(0); // action revalidates the queue

  await ownerPage.goto("/dashboard");
  await expect(
    ownerPage.getByRole("link", { name: "Greta Approve" }),
  ).toBeVisible();
});

test("a validation error keeps the typed household rows", async ({
  browser,
}) => {
  const page = await openInvitePage(browser);
  await page.locator("#first_name").fill("");
  await page.getByRole("button", { name: "Add a second person" }).click();
  await page.locator("#partner_first").fill("Pat");
  await page.getByRole("button", { name: "Add a child" }).click();
  await page.getByRole("button", { name: "Add a child" }).click();
  await page.locator("#kid_1_first").fill("Kit");
  await page.locator("#city").fill("Lisbon");
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Add my details" }).click();

  await expect(page.getByText("Add your first name.")).toBeVisible();
  await expect(
    page.getByText(
      "Add your last name so Permalink Owner can address your mail.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Add a first name, or remove this row."),
  ).toHaveCount(1);
  await expect(page.locator("#kid_0_first")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(new RegExp(`/b/${slug}$`));
  await expect(page.locator("#partner_first")).toHaveValue("Pat");
  await expect(page.locator("#kid_1_first")).toHaveValue("Kit");
  await expect(page.locator("#city")).toHaveValue("Lisbon");

  await page.getByRole("button", { name: "Remove child 1" }).click();
  await expect(page.locator("#kid_0_first")).toHaveValue("Kit");
  await expect(page.locator("#kid_1_first")).toHaveCount(0);
  await page.context().close();
});

test("a visitor adds a partner and two kids", async ({ browser }) => {
  const page = await openInvitePage(browser);
  await page.locator("#first_name").fill("Hana");
  await page.locator("#last_name").fill("Household");

  await page.getByRole("button", { name: "Add a second person" }).click();
  await page.locator("#partner_first").fill("Sam");
  await expect(page.locator("#partner_last")).toHaveValue("Household");
  await expect(page.getByText("Same last name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a second person" })).toHaveCount(0);

  await page.getByRole("button", { name: "Add a child" }).click();
  await page.locator("#kid_0_first").fill("Zoe");
  await page.getByRole("button", { name: "Add a child" }).click();
  await page.locator("#kid_1_first").fill("Max");
  await page.locator("#kid_1_last").fill("Rivera");
  await expect(page.locator("#kid_0_last")).toHaveValue("Household");

  await page.locator("#email").fill(householdEmail);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Add my details" }).click();
  await expectThanks(page);
  await page.context().close();
});

test("the owner approves a household into display names", async () => {
  await ownerPage.goto("/dashboard/review");
  const card = ownerPage.locator("ol > li", { hasText: "Hana Household" });
  await expect(card).toContainText("Sam Household");
  await expect(card).toContainText("Zoe, Max Rivera");
  await card.getByRole("button", { name: "Add contact" }).click();
  await expect(card).toHaveCount(0);

  expect(await getContactNamesByEmail(householdEmail)).toEqual({
    fullName: "Hana Household",
    partnerName: "Sam Household",
    kidsNames: "Zoe, Max Rivera",
    firstName: "Hana",
    lastName: "Household",
    partnerFirstName: "Sam",
    partnerLastName: "Household",
    kids: [
      { first: "Zoe", last: "Household" },
      { first: "Max", last: "Rivera" },
    ],
  });
});

test("a resubmission from a known email updates that contact's names", async ({
  browser,
}) => {
  await clearRateLimits();
  await submitAsVisitor(browser, {
    first_name: "Hana",
    last_name: "Newname",
    email: householdEmail,
  });

  await ownerPage.goto("/dashboard/review");
  const card = ownerPage.locator("ol > li", { hasText: "Hana Newname" });
  await card.getByRole("button", { name: "Apply update" }).click();
  await expect(card).toHaveCount(0);

  expect(await getContactNamesByEmail(householdEmail)).toMatchObject({
    fullName: "Hana Newname",
    firstName: "Hana",
    lastName: "Newname",
    partnerFirstName: "Sam",
    kids: [
      { first: "Zoe", last: "Household" },
      { first: "Max", last: "Rivera" },
    ],
    kidsNames: "Zoe Household, Max Rivera",
  });
});

test("the owner rejects a submission and it never becomes a contact", async () => {
  await ownerPage.goto("/dashboard/review");
  const card = ownerPage.locator("ol > li", { hasText: "Rex Reject" });
  await card.getByRole("button", { name: "Reject" }).click();
  await expect(card).toHaveCount(0);
  await expect(ownerPage.getByText("No pending submissions.")).toBeVisible();

  await ownerPage.goto("/dashboard");
  await expect(
    ownerPage.getByRole("link", { name: "Rex Reject" }),
  ).toHaveCount(0);
});
