import { expect, test } from "@playwright/test";
import {
  authUserExists,
  cleanupUser,
  getWaitlistRow,
  seedApprovedWaitlist,
  seedPendingWaitlist,
} from "./db";
import {
  expectNoDeliveredMessage,
  fetchMagicLink,
  requestAccess,
  signupAndLogin,
  uniqueEmail,
  waitForTurnstile,
} from "./helpers";

/** Must match ADMIN_EMAILS in .env.local.example. */
const ADMIN_EMAIL = "admin@e2e.test";

const waitlisted = uniqueEmail("waitlisted");
const approvedLater = uniqueEmail("approved-later");
const secondRequest = uniqueEmail("second-request");
const notInvited = uniqueEmail("not-invited");
const alreadyInvited = uniqueEmail("already-invited");
const invitedDirectly = uniqueEmail("invited-directly");

test.afterAll(async () => {
  for (const email of [waitlisted, approvedLater, secondRequest, notInvited, alreadyInvited, invitedDirectly]) {
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

  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Email address")).toHaveValue("");

  await page.getByLabel("Email address").fill(secondRequest);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("status")).toContainText(secondRequest);
  expect(await getWaitlistRow(secondRequest)).toMatchObject({ status: "pending" });

  // Last: the fixed sleep can span a dev-server Fast Refresh that drops the
  // client-only "sent" state, so nothing above may depend on it.
  await expectNoDeliveredMessage(waitlisted);
});

test("a waitlisted Google sign-up shows its confirmation", async ({ page }) => {
  await page.goto(
    "/auth/confirm?flow=login&error=access_denied&error_code=unexpected_failure&error_description=sealed_waitlisted",
  );
  await expect(page).toHaveURL(/\/\?requested=google$/);
  await expect(page.getByRole("status")).toContainText("You’re on the list, and your invitation will arrive");

  // Supabase falls back to the Site URL when redirect_to is unusable.
  await page.goto("/?error=access_denied&error_description=sealed_waitlisted");
  await expect(page.getByRole("status")).toContainText("You’re on the list, and your invitation will arrive");

  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Request an invitation" })).toBeVisible();
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

  await page.goto("/");
  await expect(page).toHaveURL(/\/(dashboard|onboarding)$/);

  await page.goto("/admin/waitlist");
  await page
    .getByRole("region", { name: /^Waiting/ })
    .getByRole("listitem")
    .filter({ hasText: approvedLater })
    .getByRole("button", { name: "Approve" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    `Approved ${approvedLater}. Invitation sent.`,
  );
  await expect(
    page
      .getByRole("region", { name: /^Approved/ })
      .getByRole("listitem")
      .filter({ hasText: approvedLater }),
  ).toContainText("Invitation sent");
  expect(await getWaitlistRow(approvedLater)).toMatchObject({
    status: "approved",
    invited: true,
  });
  // Generating the invitation's sign-in link creates the approved user.
  expect(await authUserExists(approvedLater)).toBe(true);

  const visitor = await browser.newPage();
  await requestAccess(visitor, approvedLater);
  const link = new URL(await fetchMagicLink(approvedLater));
  await visitor.goto(`${new URL(visitor.url()).origin}${link.pathname}${link.search}`);
  await expect(visitor).toHaveURL(/\/onboarding$/);
  await visitor.close();
});

test("the admin board offers Resend invitation on every approved row", async ({
  page,
}) => {
  await seedApprovedWaitlist(notInvited, { invited: false });
  await seedApprovedWaitlist(alreadyInvited, { invited: true });
  await signupAndLogin(page, ADMIN_EMAIL);

  await page.goto("/admin/waitlist");
  const approved = page.getByRole("region", { name: /^Approved/ }).getByRole("listitem");
  await expect(
    approved.filter({ hasText: notInvited }).getByRole("button", { name: "Resend invitation" }),
  ).toBeVisible();
  await expect(approved.filter({ hasText: alreadyInvited })).toContainText("Invitation sent");
  await expect(
    approved.filter({ hasText: alreadyInvited }).getByRole("button", { name: "Resend invitation" }),
  ).toBeVisible();
});

test("an admin invites an unlisted email directly", async ({ page }) => {
  await signupAndLogin(page, ADMIN_EMAIL);

  await page.goto("/admin/waitlist");
  await page.getByLabel("Email to send an invitation to").fill(invitedDirectly);
  await page.getByRole("button", { name: "Send invitation", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    `Approved ${invitedDirectly}. Invitation sent.`,
  );
  await expect(
    page
      .getByRole("region", { name: /^Approved/ })
      .getByRole("listitem")
      .filter({ hasText: invitedDirectly }),
  ).toContainText("Invitation sent");
});
