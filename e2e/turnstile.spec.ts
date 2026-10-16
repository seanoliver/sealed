import { expect, test, type Page } from "@playwright/test";
import { cleanupUser, clearRequestAccessLimits } from "./db";
import { uniqueEmail } from "./helpers";

type TurnstileCalls = { renders: number; resets: number; removes: number };

/**
 * Replaces Cloudflare's script with a stub that fires the token callback at
 * once and records every render/reset/remove, so widget lifecycle is observable.
 */
async function stubTurnstile(page: Page): Promise<void> {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
        window.__ts = { renders: [], resets: [], removes: [], solve: () => {} };
        let next = 0;
        window.turnstile = {
          render(el, opts) {
            const id = "stub-" + next++;
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = "cf-turnstile-response";
            input.value = "stub-token";
            el.closest("form").appendChild(input);
            window.__ts.renders.push(id);
            window.__ts.solve = opts.callback;
            opts.callback();
            return id;
          },
          reset(id) { window.__ts.resets.push(id); },
          remove(id) { window.__ts.removes.push(id); },
        };
      `,
    }),
  );
}

async function calls(page: Page): Promise<TurnstileCalls> {
  return page.evaluate(() => {
    const ts = (window as unknown as { __ts: Record<keyof TurnstileCalls, unknown[]> }).__ts;
    return { renders: ts.renders.length, resets: ts.resets.length, removes: ts.removes.length };
  });
}

test("the widget resets after a failed submit and is replaced on a different email", async ({
  page,
}) => {
  const email = uniqueEmail("turnstile");
  await clearRequestAccessLimits();
  await stubTurnstile(page);
  await page.goto("/");

  const submit = page.getByRole("button", { name: "Request access" });
  await expect(submit).toBeEnabled();
  expect(await calls(page)).toEqual({ renders: 1, resets: 0, removes: 0 });

  // An address the browser accepts but the server rejects.
  await page.getByLabel("Email address").fill("nobody@localhost");
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("Enter a valid email address.");
  await expect.poll(() => calls(page)).toEqual({ renders: 1, resets: 1, removes: 0 });
  // The stub, like a fresh challenge, does not fire the callback by itself.
  await expect(submit).toBeDisabled();

  // A real widget fires its callback once the new challenge is solved.
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
