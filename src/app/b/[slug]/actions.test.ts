import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { getPublicBook } from "@/lib/queries/public-book";
import { verifyTurnstile } from "@/lib/turnstile";
import { submitToBook } from "./actions";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/db/admin", () => ({ dbAdmin: { execute: vi.fn() } }));
vi.mock("@/lib/db/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({
  requestIp: async () => "203.0.113.9",
  hashedRateLimitKey: (prefix: string) => prefix,
}));
vi.mock("@/lib/queries/public-book", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/public-book")>()),
  getPublicBook: vi.fn(),
}));

describe("submitToBook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(verifyTurnstile).mockResolvedValue(true);
    vi.mocked(getPublicBook).mockResolvedValue({
      ownerName: "Sean",
      enabledFields: { partner_name: false, kids_names: false, birthday: false },
      senderCountry: "US",
    });
  });

  it("refuses a postcode that doesn't fit the country, on that field", async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      first_name: "Sanne",
      last_name: "de Vries",
      address_line1: "Keizersgracht 212",
      city: "Amsterdam",
      postal_code: "1016",
      country_code: "NL",
    })) {
      form.set(key, value);
    }
    const result = await submitToBook("sb-test-book", {}, form);
    expect(result).toMatchObject({
      error: "A Dutch postcode is four digits and two letters, like 1234 AB.",
      fieldErrors: { postal_code: "A Dutch postcode is four digits and two letters, like 1234 AB." },
    });
  });
});
