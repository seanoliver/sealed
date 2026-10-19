import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { contacts } from "@/lib/db/schema";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { generateToken } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";
import { sendNotification } from "@/lib/email/resend";
import { householdPrefill } from "@/lib/names";
import { INVALID_LINK_MESSAGE } from "../notice";
import { submitTokenUpdate } from "./actions";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/lib/db/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendNotification: vi.fn() }));
const deferred = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock("next/server", () => ({ after: (fn: () => unknown) => deferred.push(fn) }));
const flushAfter = async () => {
  for (const fn of deferred.splice(0)) await fn();
};
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({
  requestIp: async () => "203.0.113.9",
  hashedRateLimitKey: (prefix: string) => prefix,
}));

const U = "00000000-0000-4000-8000-0000000be001";
const B = "10000000-0000-4000-8000-0000000be001";
const C = "20000000-0000-4000-8000-0000000be001";
const TWELVE_KIDS = "A, B, C, D, E, F, G, H, I, J, K, L";

type Seed = {
  fullName: string;
  partnerName?: string | null;
  kidsNames?: string | null;
  sectionsOn?: boolean;
};

async function seed({
  fullName,
  partnerName = null,
  kidsNames = null,
  sectionsOn = true,
}: Seed) {
  await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  await dbAdmin.execute(sql`
    insert into auth.users (id, email) values (${U}, 'tu-owner@test.dev')
    on conflict (id) do nothing`);
  await dbAdmin.execute(sql`
    insert into public.profiles (id, display_name) values (${U}, 'Sean')
    on conflict (id) do update set display_name = 'Sean'`);
  await dbAdmin.execute(sql`
    insert into public.books (id, owner_id, slug, enabled_fields) values (${B}, ${U}, 'tu-test-book',
      jsonb_build_object('partner_name', ${sectionsOn}::boolean, 'kids_names', ${sectionsOn}::boolean,
        'birthday', true))`);
  await dbAdmin.execute(sql`
    insert into public.contacts (id, book_id, full_name, partner_name, kids_names, email, city)
    values (${C}, ${B}, ${fullName}, ${partnerName}, ${kidsNames}, 'old@tu.test', 'Paris')`);
  const { token, hash } = generateToken();
  await dbAdmin.execute(sql`
    insert into public.update_tokens (contact_id, token_hash, expires_at)
    values (${C}, ${hash}, now() + interval '1 day')`);
  return token;
}

/** The form exactly as /u/[token] renders it for this contact, with `city` edited. */
function prefilledForm(stored: Seed, overrides: Record<string, string> = {}) {
  const sections =
    stored.sectionsOn === false ? { partner: false, kids: false } : {};
  const household = householdPrefill(
    {
      fullName: stored.fullName,
      partnerName: stored.partnerName ?? null,
      kidsNames: stored.kidsNames ?? null,
      firstName: null,
      lastName: null,
      partnerFirstName: null,
      partnerLastName: null,
      kids: null,
    },
    sections,
  );
  const form = new FormData();
  form.set("first_name", household.first_name);
  form.set("last_name", household.last_name);
  if (stored.sectionsOn !== false) form.set("partner_section", "1");
  if (household.partner) {
    form.set("partner_first_name", household.partner.first);
    form.set("partner_last_name", household.partner.last);
  }
  if (stored.sectionsOn !== false) form.set("kids_section", "1");
  for (const kid of household.kids) {
    form.append("kid_first", kid.first);
    form.append("kid_last", kid.last);
  }
  for (const [key, value] of Object.entries({
    email: "old@tu.test",
    birthday: "",
    address_line1: "",
    address_line2: "",
    city: "Oslo",
    state_region: "",
    postal_code: "",
    country: "",
    ...overrides,
  })) {
    form.set(key, value);
  }
  return form;
}

async function stored() {
  const [row] = await dbAdmin.select().from(contacts).where(eq(contacts.id, C));
  return row;
}

describe("submitTokenUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deferred.length = 0;
    vi.restoreAllMocks();
    vi.stubEnv("APP_URL", "https://app.example");
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(verifyTurnstile).mockResolvedValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
  });

  it("saves the update, splits the names and spends the link", async () => {
    const contact = { fullName: "Ana Reyes" };
    const token = await seed(contact);
    await expect(
      submitTokenUpdate(token, {}, prefilledForm(contact)),
    ).rejects.toThrow("REDIRECT");
    expect(await stored()).toMatchObject({
      city: "Oslo",
      firstName: "Ana",
      lastName: "Reyes",
      fullName: "Ana Reyes",
    });
    await expect(
      submitTokenUpdate(token, {}, prefilledForm(contact)),
    ).resolves.toMatchObject({
      error: INVALID_LINK_MESSAGE,
    });
  });

  it("saves the details of a legacy contact over the kid cap when the names are untouched", async () => {
    const contact = { fullName: "Jen Holloway", kidsNames: TWELVE_KIDS };
    const token = await seed(contact);
    await expect(
      submitTokenUpdate(token, {}, prefilledForm(contact)),
    ).rejects.toThrow("REDIRECT");
    expect(await stored()).toMatchObject({
      city: "Oslo",
      kidsNames: TWELVE_KIDS,
      kids: null,
      firstName: null,
    });
  });

  it("saves the details of a legacy contact with an over-long name part", async () => {
    const contact = { fullName: `${"x".repeat(85)} Holloway` };
    const token = await seed(contact);
    await expect(
      submitTokenUpdate(token, {}, prefilledForm(contact)),
    ).rejects.toThrow("REDIRECT");
    expect(await stored()).toMatchObject({
      city: "Oslo",
      fullName: contact.fullName,
    });
  });

  it("compares against the sections the book shows", async () => {
    const contact = {
      fullName: `${"x".repeat(85)} Holloway`,
      kidsNames: TWELVE_KIDS,
      partnerName: "Mark",
      sectionsOn: false,
    };
    const token = await seed(contact);
    await expect(
      submitTokenUpdate(token, {}, prefilledForm(contact)),
    ).rejects.toThrow("REDIRECT");
    expect(await stored()).toMatchObject({
      city: "Oslo",
      kidsNames: TWELVE_KIDS,
      partnerName: "Mark",
    });
  });

  it("still enforces the cap once a name is edited", async () => {
    const contact = { fullName: "Jen Holloway", kidsNames: TWELVE_KIDS };
    const token = await seed(contact);
    const result = await submitTokenUpdate(
      token,
      {},
      prefilledForm(contact, { first_name: "Jenny" }),
    );
    expect(result).toMatchObject({
      fieldErrors: { kids: "Add up to 10 children." },
    });
    expect((await stored()).city).toBe("Paris");
  });

  it("asks a household label for a last name in the owner's voice", async () => {
    const contact = { fullName: "Satya & Family" };
    const token = await seed(contact);
    const form = prefilledForm(contact);
    expect(form.get("first_name")).toBe("Satya & Family");
    const result = await submitTokenUpdate(token, {}, form);
    expect(result).toMatchObject({
      fieldErrors: {
        last_name: "Add your last name so Sean can address your mail.",
      },
    });
    expect((await stored()).city).toBe("Paris");
  });

  it("rejects bad details even when the legacy names are kept", async () => {
    const contact = { fullName: "Jen Holloway", kidsNames: TWELVE_KIDS };
    const token = await seed(contact);
    const result = await submitTokenUpdate(
      token,
      {},
      prefilledForm(contact, { email: "a@b" }),
    );
    expect(result).toMatchObject({ error: "Invalid email address" });
    expect(result.fieldErrors).toBeUndefined();
    expect((await stored()).city).toBe("Paris");
  });

  it("emails the owner a link to the contact after a save", async () => {
    const contact = { fullName: "Ana Reyes" };
    const token = await seed(contact);
    await expect(submitTokenUpdate(token, {}, prefilledForm(contact))).rejects.toThrow("REDIRECT");
    expect(sendNotification).not.toHaveBeenCalled();
    await flushAfter();
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "tu-owner@test.dev",
        subject: "A contact checked their details · Sealed",
        text: expect.stringContaining(`https://app.example/dashboard/contacts/${C}`),
      }),
    );
  });

  it("emails the owner when the recipient changes their email", async () => {
    const contact = { fullName: "Ana Reyes" };
    const token = await seed(contact);
    const form = prefilledForm(contact, { email: "new@tu.test" });
    await expect(submitTokenUpdate(token, {}, form)).rejects.toThrow("REDIRECT");
    expect((await stored()).email).toBe("new@tu.test");
    await flushAfter();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("redirects even when the owner lookup fails", async () => {
    const contact = { fullName: "Ana Reyes" };
    const token = await seed(contact);
    vi.spyOn(dbAdmin, "execute").mockRejectedValueOnce(new Error("db down"));
    await expect(submitTokenUpdate(token, {}, prefilledForm(contact))).rejects.toThrow("REDIRECT");
    expect((await stored()).city).toBe("Oslo");
    await flushAfter();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("puts no recipient data in the email", async () => {
    const contact = { fullName: "Ana Reyes" };
    const token = await seed(contact);
    const form = prefilledForm(contact, { email: "secret@tu.test", address_line1: "9 Hidden Ln" });
    await expect(submitTokenUpdate(token, {}, form)).rejects.toThrow("REDIRECT");
    await flushAfter();
    const sent = JSON.stringify(vi.mocked(sendNotification).mock.calls);
    for (const value of ["Ana", "Reyes", "secret@tu.test", "9 Hidden Ln", "Oslo"]) {
      expect(sent).not.toContain(value);
    }
  });

  it("skips the email without APP_URL, still saving", async () => {
    const contact = { fullName: "Ana Reyes" };
    const token = await seed(contact);
    vi.stubEnv("APP_URL", "");
    await expect(submitTokenUpdate(token, {}, prefilledForm(contact))).rejects.toThrow("REDIRECT");
    await flushAfter();
    expect(sendNotification).not.toHaveBeenCalled();
    expect((await stored()).city).toBe("Oslo");
  });

  it("skips the email when the owner has no email address", async () => {
    const contact = { fullName: "Ana Reyes" };
    const token = await seed(contact);
    vi.spyOn(dbAdmin, "execute").mockResolvedValueOnce([{ contact_id: C, email: "" }] as never);
    await expect(submitTokenUpdate(token, {}, prefilledForm(contact))).rejects.toThrow("REDIRECT");
    await flushAfter();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends nothing when the apply refuses after the lookup", async () => {
    const contact = { fullName: "Ana Reyes" };
    const token = await seed(contact);
    const execute = dbAdmin.execute.bind(dbAdmin);
    vi.spyOn(dbAdmin, "execute")
      .mockImplementationOnce(execute)
      .mockResolvedValueOnce([{ ok: false }] as never);
    await expect(submitTokenUpdate(token, {}, prefilledForm(contact))).resolves.toMatchObject({
      error: INVALID_LINK_MESSAGE,
    });
    await flushAfter();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("still redirects when the send fails", async () => {
    const contact = { fullName: "Ana Reyes" };
    const token = await seed(contact);
    vi.mocked(sendNotification).mockResolvedValueOnce(false);
    await expect(submitTokenUpdate(token, {}, prefilledForm(contact))).rejects.toThrow("REDIRECT");
    await flushAfter();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the save is refused", async () => {
    const contact = { fullName: "Jen Holloway", kidsNames: TWELVE_KIDS };
    const token = await seed(contact);
    await submitTokenUpdate(token, {}, prefilledForm(contact, { first_name: "Jenny" }));
    await dbAdmin.execute(sql`update public.update_tokens set used_at = now() where contact_id = ${C}`);
    await submitTokenUpdate(token, {}, prefilledForm(contact));
    await flushAfter();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("refuses a malformed token without touching the database", async () => {
    await expect(
      submitTokenUpdate("short", {}, new FormData()),
    ).resolves.toEqual({
      error: INVALID_LINK_MESSAGE,
    });
    expect(checkRateLimit).not.toHaveBeenCalledWith("token-submit", 10, 3600);
  });

  it("refuses when rate limited or the bot check fails", async () => {
    const contact = { fullName: "Ana Reyes" };
    const token = await seed(contact);
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    await expect(
      submitTokenUpdate(token, {}, prefilledForm(contact)),
    ).resolves.toMatchObject({
      error: "Too many requests — please try again later.",
    });
    vi.mocked(verifyTurnstile).mockResolvedValueOnce(false);
    await expect(
      submitTokenUpdate(token, {}, prefilledForm(contact)),
    ).resolves.toMatchObject({
      error: "Verification failed — please try again.",
    });
    expect((await stored()).city).toBe("Paris");
  });

  describe("couples", () => {
    async function partnerToken() {
      await dbAdmin.execute(
        sql`update public.contacts set partner_email = 'partner@tu.test' where id = ${C}`,
      );
      const { token, hash } = generateToken();
      await dbAdmin.execute(sql`
        insert into public.update_tokens (contact_id, token_hash, expires_at, recipient)
        values (${C}, ${hash}, now() + interval '1 day', 'partner')`);
      return token;
    }

    async function seenAt(token: string): Promise<string> {
      const rows = await dbAdmin.execute(
        sql`select private.get_contact_for_token(${token}) ->> 'updated_at' as seen`,
      );
      return String(rows[0].seen);
    }

    it("edits the partner's own email through the partner's link", async () => {
      const contact = { fullName: "Ana Reyes" };
      await seed(contact);
      const token = await partnerToken();
      const form = prefilledForm(contact, { email: "new-partner@tu.test" });
      await expect(submitTokenUpdate(token, {}, form)).rejects.toThrow("REDIRECT");
      expect(await stored()).toMatchObject({
        email: "old@tu.test",
        partnerEmail: "new-partner@tu.test",
        city: "Oslo",
      });
    });

    it("queues a reply that conflicts with the other person's and tells the owner", async () => {
      const contact = { fullName: "Ana Reyes" };
      const primary = await seed(contact);
      const partner = await partnerToken();
      const form = prefilledForm(contact, { email: "partner@tu.test", city: "Lima" });
      form.set("seen_at", await seenAt(partner));

      await dbAdmin.execute(
        sql`select private.apply_token_reply(${primary}, '{"city": "Oslo"}'::jsonb)`,
      );
      await expect(submitTokenUpdate(partner, {}, form)).rejects.toThrow("REDIRECT");

      expect((await stored()).city).toBe("Oslo");
      const queued = await dbAdmin.execute(sql`
        select payload ->> 'city' as city from public.submissions
        where matched_contact_id = ${C} and status = 'pending'`);
      expect(queued.map((row) => row.city)).toEqual(["Lima"]);
      await flushAfter();
      expect(sendNotification).toHaveBeenCalledTimes(1);
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "A contact's reply needs review · Sealed",
          text: expect.stringContaining("https://app.example/dashboard/review"),
        }),
      );
    });

    it("applies a reply when the page loaded after the other person's change", async () => {
      const contact = { fullName: "Ana Reyes" };
      const primary = await seed(contact);
      const partner = await partnerToken();
      await dbAdmin.execute(
        sql`select private.apply_token_reply(${primary}, '{"city": "Oslo"}'::jsonb)`,
      );
      const form = prefilledForm(contact, { email: "partner@tu.test", city: "Lima" });
      form.set("seen_at", await seenAt(partner));
      await expect(submitTokenUpdate(partner, {}, form)).rejects.toThrow("REDIRECT");
      expect((await stored()).city).toBe("Lima");
    });
  });
});
