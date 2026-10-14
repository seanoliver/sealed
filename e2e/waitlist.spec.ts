import { expect, test } from "@playwright/test";
import {
  authUserExists,
  cleanupUser,
  getWaitlistRow,
  seedPendingWaitlist,
} from "./db";
import {
  expectNoDeliveredMessage,
  fetchMagicLink,
  requestAccess,
  signupAndLogin,
  uniqueEmail,
} from "./helpers";

/** Matches ADMIN_EMAILS in .env.local.example. */
const ADMIN_EMAIL = "admin@e2e.test";

const waitlisted = uniqueEmail("waitlisted");
const approvedLater = uniqueEmail("approved-later");

test.afterAll(async () => {
  for (const email of [waitlisted, approvedLater, ADMIN_EMAIL]) {
    await cleanupUser(email);
  }
});

test("an unapproved email joins the waitlist without an account or email", async ({
  page,
}) => {
  await requestAccess(page, waitlisted);

  await expect(page.getByRole("status")).toContainText(waitlisted);
  await expect(page.getByRole("status")).toContainText("you’re on the list");
  expect(await getWaitlistRow(waitlisted)).toEqual({
    status: "pending",
    source: "email",
    invited: false,
  });
  expect(await authUserExists(waitlisted)).toBe(false);
  await expectNoDeliveredMessage(waitlisted);

  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Email address")).toHaveValue("");
});

test("a waitlisted Google sign-up shows its confirmation", async ({ page }) => {
  await page.goto(
    "/auth/confirm?flow=login&error=access_denied&error_code=unexpected_failure&error_description=sealed_waitlisted",
  );
  await expect(page).toHaveURL(/\/\?requested=google$/);
  await expect(page.getByRole("status")).toContainText("You’re on the list.");

  // Supabase falls back to the Site URL when redirect_to is unusable.
  await page.goto("/?error=access_denied&error_description=sealed_waitlisted");
  await expect(page.getByRole("status")).toContainText("You’re on the list.");
});

test("the waitlist admin page is hidden from other owners", async ({ page }) => {
  const owner = uniqueEmail("not-admin");
  await signupAndLogin(page, owner);
  const response = await page.goto("/admin/waitlist");
  expect(response?.status()).toBe(404);
  await cleanupUser(owner);
});

test("an admin approves a waiting email, which can then sign up", async ({
  page,
  browser,
}) => {
  await seedPendingWaitlist(approvedLater);
  await signupAndLogin(page, ADMIN_EMAIL);

  // A signed-in owner visiting the entry page goes straight to their book.
  await page.goto("/");
  await expect(page).toHaveURL(/\/(dashboard|onboarding)$/);

  await page.goto("/admin/waitlist");
  await page
    .getByRole("region", { name: /^Waiting/ })
    .getByRole("listitem")
    .filter({ hasText: approvedLater })
    .getByRole("button", { name: "Approve" })
    .click();
  await expect(
    page
      .getByRole("region", { name: /^Approved/ })
      .getByRole("listitem")
      .filter({ hasText: approvedLater }),
  ).toContainText("Invited");
  expect(await getWaitlistRow(approvedLater)).toMatchObject({
    status: "approved",
    invited: true,
  });

  const visitor = await browser.newPage();
  await requestAccess(visitor, approvedLater);
  const link = new URL(await fetchMagicLink(approvedLater));
  await visitor.goto(`${new URL(visitor.url()).origin}${link.pathname}${link.search}`);
  await expect(visitor).toHaveURL(/\/onboarding$/);
  await visitor.close();
});
