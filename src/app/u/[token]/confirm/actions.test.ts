import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { contactEvents, contacts, updateTokens } from "@/lib/db/schema";
import { sendNotification } from "@/lib/email/resend";
import { generateToken } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";
import { INVALID_LINK_MESSAGE } from "../../notice";
import { confirmTokenAddress } from "./actions";

vi.mock("@/lib/db/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendNotification: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({
  requestIp: async () => "203.0.113.9",
  hashedRateLimitKey: (prefix: string) => prefix,
}));
const deferred = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => deferred.push(fn),
}));
const flushAfter = async () => {
  for (const fn of deferred.splice(0)) await fn();
};

const U = "00000000-0000-4000-8000-0000000fe001";
const B = "10000000-0000-4000-8000-0000000fe001";
const C = "20000000-0000-4000-8000-0000000fe001";

async function seed() {
  await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  await dbAdmin.execute(sql`
    insert into auth.users (id, email) values (${U}, 'cf-owner@test.dev')
    on conflict (id) do nothing`);
  await dbAdmin.execute(
    sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'cf-test-book')`,
  );
  await dbAdmin.execute(sql`
    insert into public.contacts (id, book_id, full_name, email, address_line1, city)
    values (${C}, ${B}, 'Ana Reyes', 'ana@cf.test', '1428 Alder St', 'Portland')`);
  const { token, hash } = generateToken();
  await dbAdmin.insert(updateTokens).values({
    contactId: C,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return token;
}

const stored = async () =>
  (await dbAdmin.select().from(contacts).where(eq(contacts.id, C)))[0];

describe("confirmTokenAddress", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    deferred.length = 0;
    vi.stubEnv("APP_URL", "https://app.example");
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(verifyTurnstile).mockResolvedValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("records the confirmation, changes nothing and spends the link", async () => {
    const token = await seed();
    const before = await stored();
    await expect(
      confirmTokenAddress(token, {}, new FormData()),
    ).resolves.toEqual({ confirmed: true });
    const after = await stored();
    expect(after).toMatchObject({
      fullName: before.fullName,
      email: before.email,
      addressLine1: "1428 Alder St",
      city: "Portland",
    });
    const events = await dbAdmin
      .select()
      .from(contactEvents)
      .where(eq(contactEvents.contactId, C));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "token",
      diff: expect.objectContaining({ payload: {} }),
    });
  });

  it("treats a retap after a lost response as confirmed, without a second email", async () => {
    const token = await seed();
    await confirmTokenAddress(token, {}, new FormData());
    await expect(
      confirmTokenAddress(token, {}, new FormData()),
    ).resolves.toEqual({ confirmed: true });
    await flushAfter();
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const events = await dbAdmin
      .select()
      .from(contactEvents)
      .where(eq(contactEvents.contactId, C));
    expect(events).toHaveLength(1);
  });

  it("refuses an expired link that was never used", async () => {
    const token = await seed();
    await dbAdmin
      .update(updateTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(updateTokens.contactId, C));
    await expect(
      confirmTokenAddress(token, {}, new FormData()),
    ).resolves.toEqual({
      error: INVALID_LINK_MESSAGE,
    });
  });

  it("uses the shared submit rate limit", async () => {
    const token = await seed();
    await confirmTokenAddress(token, {}, new FormData());
    expect(checkRateLimit).toHaveBeenCalledWith("token-submit", 10, 3600);
  });

  it("returns a generic error when the rate limiter or the apply fails", async () => {
    const token = await seed();
    vi.mocked(checkRateLimit).mockRejectedValueOnce(new Error("down"));
    await expect(
      confirmTokenAddress(token, {}, new FormData()),
    ).resolves.toEqual({
      error: "Something went wrong. Please try again.",
    });
    const execute = dbAdmin.execute.bind(dbAdmin);
    vi.spyOn(dbAdmin, "execute")
      .mockImplementationOnce(execute)
      .mockRejectedValueOnce(new Error("down"));
    await expect(
      confirmTokenAddress(token, {}, new FormData()),
    ).resolves.toEqual({
      error: "Something went wrong. Please try again.",
    });
    await flushAfter();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("shows the invalid-link error when the spent check fails", async () => {
    const token = await seed();
    await dbAdmin
      .update(updateTokens)
      .set({ usedAt: new Date() })
      .where(eq(updateTokens.contactId, C));
    const execute = dbAdmin.execute.bind(dbAdmin);
    vi.spyOn(dbAdmin, "execute")
      .mockImplementationOnce(execute)
      .mockImplementationOnce(execute)
      .mockRejectedValueOnce(new Error("down"));
    await expect(
      confirmTokenAddress(token, {}, new FormData()),
    ).resolves.toEqual({
      error: INVALID_LINK_MESSAGE,
    });
  });

  it("emails the owner after confirming", async () => {
    const token = await seed();
    await confirmTokenAddress(token, {}, new FormData());
    expect(sendNotification).not.toHaveBeenCalled();
    await flushAfter();
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "cf-owner@test.dev",
        text: expect.stringContaining(
          `https://app.example/dashboard/contacts/${C}`,
        ),
      }),
    );
  });

  it("refuses a malformed, unknown or used token without emailing", async () => {
    await expect(
      confirmTokenAddress("short", {}, new FormData()),
    ).resolves.toEqual({
      error: INVALID_LINK_MESSAGE,
    });
    expect(checkRateLimit).not.toHaveBeenCalled();
    await expect(
      confirmTokenAddress(generateToken().token, {}, new FormData()),
    ).resolves.toEqual({
      error: INVALID_LINK_MESSAGE,
    });
    await flushAfter();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("refuses when rate limited or the bot check fails", async () => {
    const token = await seed();
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    await expect(
      confirmTokenAddress(token, {}, new FormData()),
    ).resolves.toEqual({
      error: "Too many requests — please try again later.",
    });
    vi.mocked(verifyTurnstile).mockResolvedValueOnce(false);
    await expect(
      confirmTokenAddress(token, {}, new FormData()),
    ).resolves.toEqual({
      error: "Verification failed — please try again.",
    });
    const events = await dbAdmin
      .select()
      .from(contactEvents)
      .where(eq(contactEvents.contactId, C));
    expect(events).toHaveLength(0);
  });
});
