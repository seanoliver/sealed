import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { contactEvents, contacts, updateTokens } from "@/lib/db/schema";
import { sendNotification } from "@/lib/email/resend";
import { generateToken } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";
import { INVALID_LINK_MESSAGE } from "../../notice";
import { isSpentToken, notifyOwner, ownerForToken } from "../owner";
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
    const events = await dbAdmin.select().from(contactEvents).where(eq(contactEvents.contactId, C));
    expect(events).toHaveLength(2); // every reply is audited, even a no-change retap
  });

  it("knows a used link from an unused, unknown or unreadable one", async () => {
    const token = await seed();
    expect(await isSpentToken(token)).toBe(false);
    await confirmTokenAddress(token, {}, new FormData());
    expect(await isSpentToken(token)).toBe(true);
    expect(await isSpentToken(generateToken().token)).toBe(false);
    vi.spyOn(dbAdmin, "execute").mockRejectedValueOnce(new Error("down"));
    expect(await isSpentToken(token)).toBe(false);
  });

  it("emails the owner again when a later reply through the same link changes something", async () => {
    const token = await seed();
    await confirmTokenAddress(token, {}, new FormData());
    await flushAfter();
    await dbAdmin.execute(
      sql`insert into public.contact_events (contact_id, source, recipient, diff)
          values (${C}, 'token', 'primary', '{"before": {"city": "Oslo"}, "after": {"city": "Bergen"}}'::jsonb)`,
    );
    vi.mocked(sendNotification).mockClear();
    const owner = await ownerForToken(token);
    expect(owner?.repliedBefore).toBe(true);
    await notifyOwner(owner!);
    expect(sendNotification).toHaveBeenCalledTimes(1);
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

  it("refuses an expired link that was used before", async () => {
    const token = await seed();
    await dbAdmin
      .update(updateTokens)
      .set({ usedAt: new Date(), expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(updateTokens.contactId, C));
    await expect(
      confirmTokenAddress(token, {}, new FormData()),
    ).resolves.toEqual({
      error: INVALID_LINK_MESSAGE,
    });
    await flushAfter();
    expect(sendNotification).not.toHaveBeenCalled();
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

  it("tells the owner who confirmed, without the address", async () => {
    const token = await seed();
    await confirmTokenAddress(token, {}, new FormData());
    await flushAfter();
    const [[sent]] = vi.mocked(sendNotification).mock.calls;
    expect(sent.text).toContain(
      "Ana Reyes confirmed their details through their personal link without changing anything.",
    );
    expect(sent.subject).not.toContain("Ana");
    for (const value of ["1428 Alder St", "Portland", "ana@cf.test"]) {
      expect(JSON.stringify(sent)).not.toContain(value);
    }
  });

  it("still emails, with generic wording, when the reply's event can't be read", async () => {
    const token = await seed();
    await confirmTokenAddress(token, {}, new FormData());
    vi.spyOn(dbAdmin, "select").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await flushAfter();
    const [[sent]] = vi.mocked(sendNotification).mock.calls;
    expect(sent.text).toContain("Ana Reyes checked their details through their personal link.");
  });

  it("still emails when the reply's event is missing", async () => {
    const token = await seed();
    await confirmTokenAddress(token, {}, new FormData());
    await dbAdmin.delete(contactEvents).where(eq(contactEvents.contactId, C));
    await flushAfter();
    const [[sent]] = vi.mocked(sendNotification).mock.calls;
    expect(sent.text).toContain("Ana Reyes checked their details");
  });

  it("emails without a name when the name lookup fails", async () => {
    const token = await seed();
    vi.spyOn(dbAdmin, "select").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await confirmTokenAddress(token, {}, new FormData());
    await flushAfter();
    const [[sent]] = vi.mocked(sendNotification).mock.calls;
    expect(sent.text).toContain("One of your contacts confirmed their details");
  });

  it("judges the outcome from this recipient's reply, not the partner's", async () => {
    const token = await seed();
    await confirmTokenAddress(token, {}, new FormData());
    await dbAdmin.insert(contactEvents).values({
      contactId: C,
      source: "token",
      recipient: "partner",
      diff: { before: { city: "Portland" }, after: { city: "Salem" } },
      createdAt: new Date(Date.now() + 60_000),
    });
    await flushAfter();
    const [[sent]] = vi.mocked(sendNotification).mock.calls;
    expect(sent.text).toContain("confirmed their details");
  });

  it.each([
    ["missing", []],
    ["empty", [{ fullName: "", partnerName: null, kidsNames: null, firstName: null, lastName: null, partnerFirstName: null, partnerLastName: null, kids: null }]],
  ])("emails without a name when the contact's name is %s", async (_, rows) => {
    const token = await seed();
    vi.spyOn(dbAdmin, "select").mockImplementationOnce(
      () => ({ from: () => ({ where: async () => rows }) }) as never,
    );
    await confirmTokenAddress(token, {}, new FormData());
    await flushAfter();
    const [[sent]] = vi.mocked(sendNotification).mock.calls;
    expect(sent.text).toContain("One of your contacts confirmed their details");
  });

  it("judges the outcome from this reply, not an older one or an owner edit", async () => {
    const token = await seed();
    await dbAdmin.insert(contactEvents).values({
      contactId: C,
      source: "token",
      recipient: "primary",
      diff: { before: { city: "Salem" }, after: { city: "Portland" } },
      createdAt: new Date(Date.now() - 86_400_000),
    });
    await confirmTokenAddress(token, {}, new FormData());
    await dbAdmin.insert(contactEvents).values({
      contactId: C,
      source: "owner",
      diff: { before: { city: "Portland" }, after: { city: "Eugene" } },
      createdAt: new Date(Date.now() + 60_000),
    });
    await flushAfter();
    const [[sent]] = vi.mocked(sendNotification).mock.calls;
    expect(sent.text).toContain("confirmed their details through their personal link without changing anything.");
  });

  it("sends nothing for a token with an unknown recipient", async () => {
    const token = await seed();
    vi.spyOn(dbAdmin, "execute").mockResolvedValueOnce({
      rows: [{ contact_id: C, email: "cf-owner@test.dev", recipient: "someone" }],
    } as never);
    await confirmTokenAddress(token, {}, new FormData());
    await flushAfter();
    expect(sendNotification).not.toHaveBeenCalled();
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

  it("confirms after the other person changed the contact, without queuing", async () => {
    const primary = await seed();
    await dbAdmin.execute(
      sql`update public.contacts set partner_email = 'ben@cf.test' where id = ${C}`,
    );
    const { token: partner, hash } = generateToken();
    await dbAdmin.insert(updateTokens).values({
      contactId: C,
      tokenHash: hash,
      recipient: "partner",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const { rows: [{ seen }] } = await dbAdmin.execute(
      sql`select private.get_contact_for_token(${partner}) ->> 'updated_at' as seen`,
    );
    await dbAdmin.execute(
      sql`select private.apply_token_reply(${primary}, '{"city": "Salem"}'::jsonb)`,
    );

    const form = new FormData();
    form.set("seen_at", String(seen));
    await expect(confirmTokenAddress(partner, {}, form)).resolves.toEqual({
      confirmed: true,
    });
    expect((await stored()).city).toBe("Salem");
    const events = await dbAdmin
      .select({ recipient: contactEvents.recipient })
      .from(contactEvents)
      .where(eq(contactEvents.contactId, C));
    expect(events.map((e) => e.recipient).sort()).toEqual(["partner", "primary"]);
    const { rows: queued } = await dbAdmin.execute(
      sql`select 1 from public.submissions where matched_contact_id = ${C}`,
    );
    expect(queued).toHaveLength(0);
    await flushAfter();
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "A contact checked their details · Sealed" }),
    );
  });
});
