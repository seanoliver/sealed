import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { books, contacts, emailSends, updateTokens } from "@/lib/db/schema";
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
const COUPLE = "20000000-0000-4000-8000-0000000ae005";

const send = vi.mocked(sendAddressRequests);

function answer(outcomes: Record<string, "failed" | "unknown"> = {}) {
  let n = 0;
  send.mockImplementation(async (items) =>
    items.map((item): SendResult => {
      const status = outcomes[item.to];
      if (status === "failed")
        return { status, id: null, to: item.to, reason: "rejected" };
      if (status === "unknown") return { status, id: null, to: item.to };
      return { status: "sent", id: `re_${n++}_${Date.now()}`, to: item.to };
    }),
  );
}

function sentLinks(): Record<string, string> {
  const links: Record<string, string> = {};
  for (const [items] of send.mock.calls) {
    for (const item of items)
      links[item.to] = item.text.match(/\/u\/([\w-]+)/)![1];
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
  await dbAdmin.execute(sql`
    insert into public.contacts (id, book_id, full_name, first_name, last_name,
      partner_first_name, partner_last_name, email, partner_email, address_line1, city)
    values (${COUPLE}, ${B}, 'Pia Reyes', 'Pia', 'Reyes', 'Quinn', 'Lee',
      'pia@ra.test', 'quinn@ra.test', '1428 Alder St', 'Portland')`);
}

const recipientOf = async (token: string) =>
  (
    await dbAdmin
      .select({ recipient: updateTokens.recipient })
      .from(updateTokens)
      .where(eq(updateTokens.tokenHash, hashToken(token)))
  )[0]?.recipient;

describe("requestAddresses", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
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

  it("shows each contact their envelope and a confirm link", async () => {
    await dbAdmin
      .update(contacts)
      .set({
        addressLine1: "1428 Alder St",
        city: "Portland",
        stateRegion: "OR",
        postalCode: "97214",
      })
      .where(eq(contacts.id, A));
    answer();
    await requestAddresses({ contactIds: [A, C] });
    const [items] = send.mock.calls[0];
    const ana = items.find((item) => item.to === "ana@ra.test")!;
    const cal = items.find((item) => item.to === "cal@ra.test")!;
    const token = sentLinks()["ana@ra.test"];
    expect(ana.text).toContain(
      "  Ana Reyes\n  1428 Alder St\n  Portland, OR 97214",
    );
    expect(ana.text).toContain(
      `Yes, send it here: https://app.example/u/${token}/confirm`,
    );
    expect(cal.subject).toContain("Where should");
    expect(cal.text).not.toContain("/confirm");
  });

  it("puts the partner on the envelope only when the book collects partners", async () => {
    await dbAdmin
      .update(contacts)
      .set({ partnerName: "Mark Reyes" })
      .where(eq(contacts.id, A));
    const envelopeFor = async (partner: boolean) => {
      await dbAdmin
        .update(books)
        .set({
          enabledFields: {
            partner_name: partner,
            kids_names: false,
            birthday: false,
          },
        })
        .where(eq(books.id, B));
      send.mockReset();
      answer();
      await requestAddresses({ contactIds: [A] });
      return send.mock.calls[0][0][0].text;
    };
    expect(await envelopeFor(true)).toContain("Ana & Mark Reyes");
    expect(await envelopeFor(false)).not.toContain("Mark");
  });

  it("uses the split names on the envelope", async () => {
    await dbAdmin
      .update(contacts)
      .set({
        firstName: "Ana María",
        lastName: "Reyes Díaz",
        partnerFirstName: "Mark",
        partnerLastName: "Lee",
      })
      .where(eq(contacts.id, A));
    await dbAdmin
      .update(books)
      .set({
        enabledFields: {
          partner_name: true,
          kids_names: false,
          birthday: false,
        },
      })
      .where(eq(books.id, B));
    answer();
    await requestAddresses({ contactIds: [A] });
    expect(send.mock.calls[0][0][0].text).toContain(
      "Ana María Reyes Díaz & Mark Lee",
    );
  });

  it("records failed and unconfirmed sends so the table can flag them", async () => {
    answer({ "ana@ra.test": "failed", "cal@ra.test": "unknown" });
    await requestAddresses({ contactIds: [A, C] });
    const sends = await dbAdmin
      .select({
        contactId: emailSends.contactId,
        status: emailSends.status,
        reason: emailSends.failureReason,
      })
      .from(emailSends)
      .where(inArray(emailSends.contactId, [A, C]));
    expect(
      sends.sort((x, y) => x.contactId.localeCompare(y.contactId)),
    ).toEqual([
      { contactId: A, status: "failed", reason: "rejected" },
      { contactId: C, status: "unconfirmed", reason: null },
    ]);
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
      send.mock.calls.length > 0
        ? Promise.reject(new Error("db down"))
        : transaction(...args),
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

  it("emails each person in a couple their own link", async () => {
    answer();
    await expect(requestAddresses({ contactIds: [COUPLE] })).resolves.toEqual({
      sent: 2,
      skippedNoEmail: 0,
      failed: 0,
      failedContactIds: [],
    });
    const links = sentLinks();
    expect(Object.keys(links).sort()).toEqual(["pia@ra.test", "quinn@ra.test"]);
    expect(await recipientOf(links["pia@ra.test"])).toBe("primary");
    expect(await recipientOf(links["quinn@ra.test"])).toBe("partner");
    const sends = await dbAdmin
      .select({ recipient: emailSends.recipient, status: emailSends.status })
      .from(emailSends)
      .where(eq(emailSends.contactId, COUPLE));
    expect(sends.map((s) => s.recipient).sort()).toEqual(["partner", "primary"]);
  });

  it("greets each person by name and shows both the same envelope", async () => {
    answer();
    await requestAddresses({ contactIds: [COUPLE] });
    const [items] = send.mock.calls[0];
    const pia = items.find((item) => item.to === "pia@ra.test")!;
    const quinn = items.find((item) => item.to === "quinn@ra.test")!;
    expect(pia.text).toMatch(/^Hi Pia, /);
    expect(quinn.text).toMatch(/^Hi Quinn, /);
    const envelope = (text: string) => text.split("\n\n")[1];
    expect(envelope(pia.text)).toContain("1428 Alder St");
    expect(envelope(quinn.text)).toBe(envelope(pia.text));
    expect(pia.subject).toBe(quinn.subject);
  });

  it("retires only the old link of the person whose new email went out", async () => {
    answer();
    await requestAddresses({ contactIds: [COUPLE] });
    const first = sentLinks();

    send.mockReset();
    answer({ "quinn@ra.test": "failed" });
    await expect(requestAddresses({ contactIds: [COUPLE] })).resolves.toMatchObject({
      sent: 1,
      failed: 1,
      failedContactIds: [COUPLE],
    });
    expect(await isLive(COUPLE, first["pia@ra.test"])).toBe(false);
    expect(await isLive(COUPLE, first["quinn@ra.test"])).toBe(true);
    expect(await isLive(COUPLE, sentLinks()["pia@ra.test"])).toBe(true);
    expect(await liveTokens(COUPLE)).toHaveLength(2);
  });

  it("lists a contact once in failedContactIds when both emails fail", async () => {
    answer({ "pia@ra.test": "failed", "quinn@ra.test": "unknown" });
    await expect(requestAddresses({ contactIds: [COUPLE] })).resolves.toMatchObject({
      sent: 0,
      failed: 2,
      failedContactIds: [COUPLE],
    });
  });

  it("caps a request at 1000 emails, counting couples twice", async () => {
    const rows = await dbAdmin.execute(sql`
      insert into public.contacts (book_id, full_name, email, partner_email)
      select ${B}, 'Couple ' || n, 'a' || n || '@cap.test', 'b' || n || '@cap.test'
      from generate_series(1, 501) n
      returning id`);
    const ids = rows.map((row) => String(row.id));
    await expect(requestAddresses({ contactIds: ids })).resolves.toEqual({
      error: "That's more than 1000 emails. Select fewer contacts.",
    });
    expect(send).not.toHaveBeenCalled();
    const [{ count }] = await dbAdmin.execute(sql`
      select count(*)::int as count from public.update_tokens t
      join public.contacts c on c.id = t.contact_id where c.book_id = ${B}`);
    expect(count).toBe(0);
  });

  it("rejects malformed ids", async () => {
    await expect(requestAddresses({ contactIds: ["nope"] })).resolves.toEqual({
      error: "Invalid request.",
    });
  });
});
