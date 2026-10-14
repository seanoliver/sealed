import { expect, test } from "@playwright/test";
import { approveEmail } from "./db";
import {
  createBook,
  fetchDeliveredMessage,
  requestAccess,
  signupAndLogin,
  uniqueEmail,
  uniqueSlug,
} from "./helpers";

test.describe("Sealed branding", () => {
  test("landing page presents Sealed as the product", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
    await expect(page.getByText("Address Book", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Private beta · by invitation")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Request an invitation" }),
    ).toBeVisible();
  });

  test("publishes Sealed canonical and social metadata from the configured origin", async ({
    page,
  }) => {
    await page.goto("/");

    const canonicalOrigin = process.env.APP_URL!;
    await expect(page).toHaveTitle("Sealed");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "A private address book that friends and family can keep current.",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      canonicalOrigin,
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      "Sealed",
    );
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      "content",
      "Sealed",
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      canonicalOrigin,
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );

  });

  test("offers an installable Sealed web-app manifest", async ({ page }) => {
    await page.goto("/");

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBeTruthy();
    const response = await page.request.get(manifestHref!);
    expect(response.ok()).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      name: "Sealed",
      short_name: "Sealed",
      description: "A private address book that friends and family can keep current.",
      start_url: "/",
      display: "standalone",
    });
  });

  test("uses the sealed-envelope identity for browser, app, and social surfaces", async ({
    page,
  }) => {
    await page.goto("/");

    const iconHref = await page
      .locator('link[rel="icon"][type="image/svg+xml"]')
      .getAttribute("href");
    expect(iconHref).toBeTruthy();
    const iconResponse = await page.request.get(iconHref!);
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toContain("image/svg+xml");
    expect(await iconResponse.text()).toContain("Sealed envelope mark");

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    const manifest = (await (await page.request.get(manifestHref!)).json()) as {
      icons?: { src: string; type?: string }[];
    };
    expect(manifest.icons).toContainEqual(
      expect.objectContaining({ src: "/icon.svg", type: "image/svg+xml" }),
    );

    for (const selector of [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
    ]) {
      const canonicalImageUrl = await page.locator(selector).getAttribute("content");
      expect(canonicalImageUrl?.startsWith(`${process.env.APP_URL}/`)).toBe(true);
      const imagePath = new URL(canonicalImageUrl!).pathname;
      const imageResponse = await page.request.get(imagePath);
      expect(imageResponse.ok()).toBe(true);
      expect(imageResponse.headers()["content-type"]).toContain("image/png");
    }
  });

  test("delivers a branded, privacy-preserving auth email with the real callback", async ({
    page,
  }) => {
    const email = uniqueEmail("sealed-auth-mail");
    await approveEmail(email);
    await requestAccess(page, email);

    const message = await fetchDeliveredMessage(email);
    expect(message.Subject).toBe("Your Sealed sign-in link");
    for (const part of [message.Subject, message.HTML, message.Text]) {
      expect(part).toContain("Sealed");
      expect(part).not.toContain(email);
    }
    expect(message.HTML).toContain("/auth/confirm?flow=login&token_hash=");
    expect(message.HTML).toContain("&type=email");
    const callbackUrl = message.HTML.match(/href="([^"]+\/auth\/confirm[^"]+)"/)?.[1];
    expect(callbackUrl).toBeTruthy();
    expect(new URL(callbackUrl!).origin).toBe(
      new URL(process.env.APP_URL!).origin,
    );
  });

  test("old sign-in and sign-up links lead to the entry page", async ({ page }) => {
    for (const path of ["/login", "/signup"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByRole("heading", { name: "Request an invitation" }),
      ).toBeVisible();
    }
  });

  test("owner pages keep the Sealed wordmark and address-book domain language", async ({
    page,
  }) => {
    await signupAndLogin(page, uniqueEmail("sealed-brand"));

    await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Create your address book" }),
    ).toBeVisible();

    await createBook(page, {
      displayName: "Brand Owner",
      slug: uniqueSlug("sealed-brand"),
    });
    await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your address book" }),
    ).toBeVisible();

    await page.goto("/dashboard/settings");
    await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Address book settings" }),
    ).toBeVisible();
  });
});
