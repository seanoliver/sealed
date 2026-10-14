import { expect, test } from "@playwright/test";

test("www permanently redirects an invite POST to the apex without losing its path or query", async ({
  request,
}) => {
  const response = await request.post(
    "/b/friends/thanks?from=old-link&return=%2Fu%2Fprivate-token",
    {
      headers: { host: "www.sealed.page" },
      maxRedirects: 0,
    },
  );

  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe(
    "https://sealed.page/b/friends/thanks?from=old-link&return=%2Fu%2Fprivate-token",
  );
});

test("the legacy production alias permanently redirects a token URL to the apex", async ({
  request,
}) => {
  const response = await request.get(
    "/u/private-token?message=hello%20there&symbols=%26%3D%3F",
    {
      headers: { host: "address-book-umber-tau.vercel.app" },
      maxRedirects: 0,
    },
  );

  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe(
    "https://sealed.page/u/private-token?message=hello%20there&symbols=%26%3D%3F",
  );
});

test("a Vercel Cron request to the legacy production alias reaches the health check", async ({
  request,
}) => {
  const response = await request.get("/api/health", {
    headers: {
      host: "address-book-umber-tau.vercel.app",
      "x-vercel-cron-schedule": "0 12 * * *",
    },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(401);
});

test("the legacy production alias still redirects /api/health without the cron header", async ({
  request,
}) => {
  const response = await request.get("/api/health", {
    headers: { host: "address-book-umber-tau.vercel.app" },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(308);
});

const nonRedirectingHosts = [
  { name: "the canonical apex", host: "sealed.page" },
  { name: "local development", host: "localhost:3000" },
  {
    name: "a deployment-specific URL",
    host: "sealed-ojgrtho1p-cabin-9.vercel.app",
  },
  { name: "a regex lookalike of an allowed host", host: "www-sealed.page" },
];

for (const { name, host } of nonRedirectingHosts) {
  test(`${name} renders without redirecting`, async ({ request }) => {
    const response = await request.get("/login", {
      headers: { host },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(200);
    expect(response.headers().location).toBeUndefined();
  });
}
