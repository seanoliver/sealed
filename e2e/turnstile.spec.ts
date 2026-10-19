import { expect, test } from "@playwright/test";
import { cleanupUser, clearRequestAccessLimits } from "./db";
import { calls, stubTurnstile, uniqueEmail } from "./helpers";

test("the widget resets after a failed submit and is replaced on a different email", async ({
  page,
}) => {
  const email = uniqueEmail("turnstile");
  await clearRequestAccessLimits();
  await stubTurnstile(page);
  await page.goto("/");

  const submit = page.getByRole("button", { name: /Request access|Checking you’re human/ });
  await expect(submit).toBeEnabled();
  expect(await calls(page)).toEqual({ renders: 1, resets: 0, removes: 0 });

  // An address the browser accepts but the server rejects.
  await page.getByLabel("Email address").fill("nobody@localhost");
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("Enter a valid email address.");
  await expect(page.getByLabel("Email address")).toHaveValue("nobody@localhost");
  await expect.poll(() => calls(page)).toEqual({ renders: 1, resets: 1, removes: 0 });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText("Checking you’re human…");

  await page.evaluate(() => (window as unknown as { __ts: { solve: () => void } }).__ts.solve());
  await expect(submit).toBeEnabled();
  await page.getByLabel("Email address").fill(email);
  await submit.click();
  await expect(page.getByRole("heading", { name: "Your request is in" })).toBeVisible();

  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Email address")).toHaveValue("");
  await expect.poll(async () => (await calls(page)).renders).toBe(2);
  expect((await calls(page)).removes).toBeGreaterThanOrEqual(1);
  await expect(submit).toBeEnabled();
  await cleanupUser(email);
});

test("a blocked Turnstile script explains why Request access is disabled", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.abort("blockedbyclient"),
  );
  await page.goto("/");

  await expect(
    page.getByRole("alert").filter({ hasText: "verification check didn’t load" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Request access" })).toBeDisabled();
});

test("a failed challenge explains itself and clears once a retry solves it", async ({ page }) => {
  await stubTurnstile(page, { failChallenge: true });
  await page.goto("/");

  const alert = page.getByRole("alert").filter({ hasText: "verification check didn’t load" });
  const submit = page.getByRole("button", { name: "Request access" });
  await expect(alert).toBeVisible();
  await expect(submit).toBeDisabled();

  await page.evaluate(() => (window as unknown as { __ts: { solve: () => void } }).__ts.solve());
  await expect(alert).toBeHidden();
  await expect(submit).toBeEnabled();
});
