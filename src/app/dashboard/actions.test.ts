import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { emailSends, updateTokens } from "@/lib/db/schema";
import { sendAddressRequests, type SendResult } from "@/lib/email/resend";
import { hashToken } from "@/lib/tokens";
import { requestAddresses } from "./actions";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({
  isEmailDryRun: () => false,
  sendAddressRequests: vi.fn(),
}));

const U = "00000000-0000-4000-8000-0000000ae001";
const OTHER = "00000000-0000-4000-8000-0000000ae002";
const B = "10000000-0000-4000-8000-0000000ae001";
const B_OTHER = "10000000-0000-4000-8000-0000000ae002";
const A = "20000000-0000-4000-8000-0000000ae001";
const C = "20000000-0000-4000-8000-0000000ae002";
const NO_EMAIL = "20000000-0000-4000-8000-0000000ae003";
const FOREIGN = "20000000-0000-4000-8000-0000000ae004";

const send = vi.mocked(sendAddressRequests);

function answer(outcomes: Record<string, "failed" | "unknown"> = {}) {
  let n = 0;
  send.mockImplementation(async (items) =>
    items.map((item): SendResult => {
      const status = outcomes[item.to];
      return status
        ? { status, id: null, to: item.to }
        : { status: "sent", id: `re_${n++}_${Date.now()}`, to: item.to };
    }),
  );
}

function sentLinks(): Record<string, string> {
  const links: Record<string, string> = {};
  for (const [items] of send.mock.calls) {
    for (const item of items)
      links[item.to] = item.text.match(/\/u\/(\S+)/)![1];
  }
  return links;
}

async function liveTokens(contactId: string) {
  return dbAdmin
    .select({ hash: updateTokens.tokenHash })
    .from(updateTokens)
    .where(eq(updateTokens.contactId, contactId));
}

const isLive = async (contactId: string, token: string) =>
  (await liveTokens(contactId)).some((row) =>
    row.hash.equals(hashToken(token)),
  );

async function reset() {
  await dbAdmin.execute(
    sql`delete from public.books where id in (${B}, ${B_OTHER})`,
  );
  await dbAdmin.execute(sql`
    insert into auth.users (id, email) values
      (${U}, 'ra-owner@test.dev'), (${OTHER}, 'ra-other@test.dev')
    on conflict (id) do nothing`);
  await dbAdmin.execute(sql`
    insert into public.books (id, owner_id, slug) values
      (${B}, ${U}, 'ra-test-book'), (${B_OTHER}, ${OTHER}, 'ra-other-book')`);
  await dbAdmin.execute(sql`
    insert into public.contacts (id, book_id, full_name, email) values
      (${A}, ${B}, 'Ana Reyes', 'ana@ra.test'),
      (${C}, ${B}, 'Cal Ortiz', 'cal@ra.test'),
      (${NO_EMAIL}, ${B}, 'Satya''s Family', null),
      (${FOREIGN}, ${B_OTHER}, 'Not Yours', 'foreign@ra.test')`);
}

describe("requestAddresses", () => {
  beforeEach(async () => {
    vi.stubEnv("APP_URL", "https://app.example");
    vi.mocked(requireUser).mockResolvedValue({ sub: U });
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockReset();
    await reset();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await dbAdmin.execute(
      sql`delete from public.books where id in (${B}, ${B_OTHER})`,
    );
  });

  it("emails each contact a working link and records the send", async () => {
    answer();
    await expect(
      requestAddresses({ contactIds: [A, C, NO_EMAIL] }),
    ).resolves.toEqual({
      sent: 2,
      skippedNoEmail: 1,
      failed: 0,
      failedContactIds: [],
    });
    const links = sentLinks();
    expect(Object.keys(links).sort()).toEqual(["ana@ra.test", "cal@ra.test"]);
    expect(send.mock.calls[0][0][0].text).toContain("https://app.example/u/");
    expect(await isLive(A, links["ana@ra.test"])).toBe(true);
    const sends = await dbAdmin
      .select()
      .from(emailSends)
      .where(inArray(emailSends.contactId, [A, C]));
    expect(sends).toHaveLength(2);
  });

  it("never emails another owner's contact", async () => {
    answer();
    const result = await requestAddresses({ contactIds: [A, FOREIGN] });
    expect(result).toMatchObject({ sent: 1 });
    expect(Object.keys(sentLinks())).toEqual(["ana@ra.test"]);
    expect(await liveTokens(FOREIGN)).toHaveLength(0);
  });

  it("keeps the old link working when the new email fails", async () => {
    answer();
    await requestAddresses({ contactIds: [A] });
    const first = sentLinks()["ana@ra.test"];

    send.mockReset();
    answer({ "ana@ra.test": "failed" });
    await expect(
      requestAddresses({ contactIds: [A, C] }),
    ).resolves.toMatchObject({
      sent: 1,
      failed: 1,
      failedContactIds: [A],
    });
    expect(await isLive(A, first)).toBe(true);
    expect(await liveTokens(A)).toHaveLength(1);
  });

  it("keeps both links when Resend never confirmed the email", async () => {
    answer();
    await requestAddresses({ contactIds: [A] });
    const first = sentLinks()["ana@ra.test"];

    send.mockReset();
    answer({ "ana@ra.test": "unknown" });
    await expect(requestAddresses({ contactIds: [A] })).resolves.toMatchObject({
      failed: 1,
      failedContactIds: [A],
    });
    const second = sentLinks()["ana@ra.test"];
    expect(await isLive(A, first)).toBe(true);
    expect(await isLive(A, second)).toBe(true);
  });

  it("retires the old link only after the new email is sent", async () => {
    answer();
    await requestAddresses({ contactIds: [A] });
    const first = sentLinks()["ana@ra.test"];

    send.mockReset();
    answer();
    await requestAddresses({ contactIds: [A] });
    const second = sentLinks()["ana@ra.test"];
    expect(await isLive(A, first)).toBe(false);
    expect(await isLive(A, second)).toBe(true);
  });

  it("does not retire a link minted by a newer send", async () => {
    answer();
    let newer = "";
    send.mockImplementationOnce(async (items) => {
      send.mockImplementationOnce(async (inner) =>
        inner.map((item, i) => ({
          status: "sent" as const,
          id: `re_inner_${i}`,
          to: item.to,
        })),
      );
      await requestAddresses({ contactIds: [A] });
      newer = sentLinks()["ana@ra.test"];
      return items.map((item, i) => ({
        status: "sent" as const,
        id: `re_outer_${i}`,
        to: item.to,
      }));
    });
    await requestAddresses({ contactIds: [A] });
    expect(newer).not.toBe("");
    expect(await isLive(A, newer)).toBe(true);
  });

  it("never deletes a link the contact already used", async () => {
    answer();
    await requestAddresses({ contactIds: [A] });
    await dbAdmin
      .update(updateTokens)
      .set({ usedAt: new Date() })
      .where(eq(updateTokens.contactId, A));

    send.mockReset();
    answer();
    await requestAddresses({ contactIds: [A] });
    expect(await liveTokens(A)).toHaveLength(2);
  });

  it("returns an error and sends nothing when minting fails", async () => {
    vi.spyOn(dbAdmin, "insert").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await expect(requestAddresses({ contactIds: [A] })).resolves.toEqual({
      error: "Something went wrong. Please try again.",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("still reports the sends, and keeps every link, when bookkeeping fails", async () => {
    answer();
    await requestAddresses({ contactIds: [A] });
    const first = sentLinks()["ana@ra.test"];

    send.mockReset();
    answer();
    const transaction = dbAdmin.transaction.bind(dbAdmin);
    vi.spyOn(dbAdmin, "transaction").mockImplementation((...args) =>
      send.mock.calls.length > 0 ? Promise.reject(new Error("db down")) : transaction(...args),
    );
    await expect(requestAddresses({ contactIds: [A] })).resolves.toMatchObject({
      sent: 1,
      failed: 0,
    });
    expect(await isLive(A, first)).toBe(true);
    expect(await isLive(A, sentLinks()["ana@ra.test"])).toBe(true);
  });

  it("passes a fresh idempotency batch key on every request", async () => {
    answer();
    await requestAddresses({ contactIds: [A] });
    await requestAddresses({ contactIds: [A] });
    const [k1, k2] = send.mock.calls.map(([, opts]) => opts.batchKey);
    expect(k1).toMatch(/^[0-9a-f-]{36}$/);
    expect(k1).not.toBe(k2);
  });

  it("sends nothing when every target lacks an email", async () => {
    await expect(requestAddresses({ contactIds: [NO_EMAIL] })).resolves.toEqual(
      {
        sent: 0,
        skippedNoEmail: 1,
        failed: 0,
        failedContactIds: [],
      },
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects malformed ids", async () => {
    await expect(requestAddresses({ contactIds: ["nope"] })).resolves.toEqual({
      error: "Invalid request.",
    });
  });
});
