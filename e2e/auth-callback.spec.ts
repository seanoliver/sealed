import { expect, test } from "@playwright/test";
import { approveEmail, cleanupUser } from "./db";
import { fetchMagicLink, requestAccess, uniqueEmail } from "./helpers";

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
  // follows the confirmation route's generic failure path instead of leaving
  // the visitor stranded on the public homepage with a code in the URL.
  await expect(page).toHaveURL(/\/\?error=1$/);
  await expect(
    page.getByRole("alert").filter({ hasText: "It may have expired or already been used" }),
  ).toBeVisible();
});
