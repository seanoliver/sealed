import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "./auth";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));

function signedInAs(email: string | undefined) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "user-1", email } }, error: null }),
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("requireAdmin", () => {
  beforeEach(() => vi.stubEnv("ADMIN_EMAILS", " Owner@Example.test , second@example.test"));
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a listed email regardless of case and spacing", async () => {
    signedInAs("owner@example.TEST");
    await expect(requireAdmin()).resolves.toMatchObject({ sub: "user-1" });
  });

  it.each([["an unlisted email", "someone@example.test"], ["a token without one", undefined]])(
    "404s for %s",
    async (_label, email) => {
      signedInAs(email);
      await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
    },
  );

  it("404s for everyone when ADMIN_EMAILS is empty or unset", async () => {
    signedInAs("owner@example.test");
    vi.stubEnv("ADMIN_EMAILS", "");
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
    vi.stubEnv("ADMIN_EMAILS", undefined);
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
  });

  it("sends signed-out visitors to the entry page", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getClaims: async () => ({ data: null, error: null }) },
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    await expect(requireAdmin()).rejects.toThrow("REDIRECT /");
  });
});
