import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/** Supabase's local Mailpit (config.toml [local_smtp], port 54324). */
const MAILPIT_URL = "http://127.0.0.1:54324";

/** Unique-per-run factories so concurrent/repeated runs never collide. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}@e2e.test`;
}

export function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export type DeliveredMessage = {
  Subject: string;
  HTML: string;
  Text: string;
};

/** Poll Mailpit for the newest fully rendered message delivered to `email`. */
export async function fetchDeliveredMessage(
  email: string,
): Promise<DeliveredMessage> {
  const query = encodeURIComponent(`to:${email}`);
  let message: DeliveredMessage | null = null;
  await expect
    .poll(
      async () => {
        const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
        if (!search.ok) return null;
        const { messages } = (await search.json()) as {
          messages: { ID: string }[];
        };
        if (messages.length === 0) return null;
        const response = await fetch(
          `${MAILPIT_URL}/api/v1/message/${messages[0].ID}`,
        );
        if (!response.ok) return null;
        message = (await response.json()) as DeliveredMessage;
        return message;
      },
      { message: `email for ${email} in Mailpit`, timeout: 15_000 },
    )
    .not.toBeNull();
  if (message === null) throw new Error(`no email found for ${email}`);
  return message;
}

/** Pull the real /auth/confirm magic link out of the rendered email body. */
export async function fetchMagicLink(email: string): Promise<string> {
  const { Text } = await fetchDeliveredMessage(email);
  const link = Text.match(/https?:\/\/[^\s)]+\/auth\/confirm[^\s)]*/)?.[0];
  if (!link) throw new Error(`no magic link found for ${email}`);
  return link;
}

/**
 * Sign up (or in) through the REAL /login form: request a magic link, fetch
 * it from Mailpit, and visit it. Existing owners land on /dashboard; a new
 * owner is redirected into /onboarding.
 */
export async function signupAndLogin(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(
    page.getByText("Check your email for a sign-in link."),
  ).toBeVisible();
  const link = new URL(await fetchMagicLink(email));
  expect(link.origin).toBe(new URL(process.env.APP_URL!).origin);
  // Keep worktree/custom-port runs on the origin where this browser began.
  // The auth callback path and token parameters still come from the real email.
  const pageOrigin = new URL(page.url()).origin;
  await page.goto(`${pageOrigin}${link.pathname}${link.search}`);
  await expect(page).toHaveURL(/\/(dashboard|onboarding)$/);
}

/** Create (or update) the signed-in owner's book through the real UI. */
export async function createBook(
  page: Page,
  opts: {
    displayName: string;
    slug: string;
    /** Omitted toggles keep the form defaults (all disabled for a new book). */
    toggles?: Partial<Record<"partner_name" | "kids_names" | "birthday", boolean>>;
  },
): Promise<void> {
  await page.goto("/dashboard/settings");

  if (/\/onboarding$/.test(page.url())) {
    await page.locator("#display_name").fill(opts.displayName);
    await page.locator("#slug").fill(opts.slug);
    await page.getByRole("button", { name: "Continue to preview" }).click();
    await expect(page.getByText("Step 2 of 2")).toBeVisible();
    for (const [name, on] of Object.entries(opts.toggles ?? {})) {
      const labels = {
        partner_name: "Partner name",
        kids_names: "Kids' names",
        birthday: "Birthday",
      } as const;
      await page
        .getByRole("switch", {
          name: labels[name as keyof typeof labels],
        })
        .setChecked(on);
    }
    await page.getByRole("button", { name: "Create my address book" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    return;
  }

  await page.locator("#display_name").fill(opts.displayName);
  await page.locator("#slug").fill(opts.slug);
  for (const [name, on] of Object.entries(opts.toggles ?? {})) {
    await page.locator(`input[name="${name}"]`).setChecked(on);
  }
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
}

/**
 * Wait for the Turnstile widget to inject a non-empty cf-turnstile-response
 * into the enclosing form. The local always-pass test keys resolve without
 * interaction, but the script loads from Cloudflare — submit before the
 * response exists and verification fails closed.
 */
export async function waitForTurnstile(page: Page): Promise<void> {
  await expect(
    page.locator('input[name="cf-turnstile-response"]'),
  ).toHaveValue(/.+/, { timeout: 20_000 });
}
