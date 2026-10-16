import { expect, test } from "@playwright/test";
import { approveEmail, cleanupUser } from "./db";
import { fetchMagicLink, requestAccess, uniqueEmail, waitForTurnstile } from "./helpers";

test("a failed magic link returns to the entry page with an error", async ({ page }) => {
  const email = uniqueEmail("link-error");
  await approveEmail(email);
  await requestAccess(page, email);

  const link = new URL(await fetchMagicLink(email));
  expect(link.origin).toBe(new URL(process.env.APP_URL!).origin);
  link.searchParams.set("token_hash", "not-a-real-token-hash");
  const pageOrigin = new URL(page.url()).origin;
  await page.goto(`${pageOrigin}${link.pathname}${link.search}`);

  await expect(page).toHaveURL(/\/\?error=1$/);
  await expect(
    page.getByRole("alert").filter({ hasText: "It may have expired or already been used" }),
  ).toBeVisible();
  await cleanupUser(email);
});

test("a provider fallback code at the site root reaches auth confirmation", async ({
  page,
}) => {
  await page.goto("/?code=not-a-real-oauth-code");

  // The root hands the code to /auth/confirm. A deliberately invalid code then
  // follows the Google failure path instead of leaving the visitor stranded on
  // the public homepage with a code in the URL.
  await expect(page).toHaveURL(/\/\?error=oauth$/);
  await expect(
    page.getByRole("alert").filter({ hasText: "Google sign-in didn’t finish" }),
  ).toBeVisible();
});

test("a cancelled Google consent returns to the entry page with the Google message", async ({
  page,
}) => {
  await page.goto(
    "/auth/confirm?flow=login&error=access_denied&error_description=The+resource+owner+or+authorization+server+denied+the+request",
  );
  await expect(page).toHaveURL(/\/\?error=oauth$/);
  await expect(
    page.getByRole("alert").filter({ hasText: "Google sign-in didn’t finish" }),
  ).toBeVisible();
  // Supabase falls back to the Site URL when redirect_to is unusable.
  await page.goto("/?error=access_denied&error_description=denied");
  await expect(
    page.getByRole("alert").filter({ hasText: "Google sign-in didn’t finish" }),
  ).toBeVisible();
});

test("the link-failed alert goes away after requesting access and using a different email", async ({
  page,
}) => {
  const email = uniqueEmail("alert-clears");
  await page.goto("/?error=1");
  await expect(
    page.getByRole("alert").filter({ hasText: "That sign-in link didn’t work" }),
  ).toBeVisible();

  await page.getByLabel("Email address").fill(email);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByRole("heading", { name: "Your request is in" })).toBeVisible();

  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Email address")).toHaveValue("");
  // Next's empty route announcer is also role=alert, so match only alerts with text.
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  await cleanupUser(email);
});
