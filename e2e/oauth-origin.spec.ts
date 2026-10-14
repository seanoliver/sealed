import { expect, test } from "@playwright/test";

test("OAuth returns to the origin where sign-in started", async ({ page }) => {
  const loginOrigin = `http://127.0.0.1:${process.env.E2E_PORT ?? "3000"}`;
  await page.goto(`${loginOrigin}/`);

  const authorizeRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/auth/v1/authorize" &&
      url.searchParams.get("provider") === "google"
    );
  });

  await page.getByRole("button", { name: "Continue with Google" }).click();
  const request = await authorizeRequest;
  const redirectTo = new URL(request.url()).searchParams.get("redirect_to");

  expect(redirectTo).not.toBeNull();
  expect(new URL(redirectTo!).origin).toBe(loginOrigin);
});
