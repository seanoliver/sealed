import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { Webhook } from "svix";
import { dbAdmin } from "@/lib/db/admin";
import { POST } from "./route";

// Fixed ids keep re-runs idempotent (same pattern as public-book.test.ts).
const U1 = "00000000-0000-0000-0000-00000000e001";
const B1 = "10000000-0000-0000-0000-00000000e001";
const C1 = "20000000-0000-0000-0000-00000000e001";
const S1 = "30000000-0000-0000-0000-00000000e001";
const RESEND_ID = "re_test_webhook_0001";

// svix secrets are "whsec_" + base64 key material.
const SECRET = "whsec_" + Buffer.from("route-test-secret-0123456789abcdef").toString("base64");
const WRONG_SECRET = "whsec_" + Buffer.from("a-completely-different-secret!!!").toString("base64");

const URL_ = "http://localhost:3000/api/webhooks/resend";

let msgCounter = 0;

/** Sign `payload` the way svix (and therefore Resend) does. */
function signedHeaders(payload: string, secret: string = SECRET): Record<string, string> {
  const id = `msg_route_test_${msgCounter++}`;
  const ts = new Date();
  return {
    "svix-id": id,
    "svix-timestamp": Math.floor(ts.getTime() / 1000).toString(),
    "svix-signature": new Webhook(secret).sign(id, ts, payload),
  };
}

function post(payload: string, headers: Record<string, string>): Promise<Response> {
  return POST(new Request(URL_, { method: "POST", headers, body: payload }));
}

function eventPayload(type: string, emailId: string = RESEND_ID, createdAt: Date = new Date()): string {
  return JSON.stringify({ type, created_at: createdAt.toISOString(), data: { email_id: emailId } });
}

const ELEVEN_MINUTES_AGO = () => new Date(Date.now() - 11 * 60 * 1000);

async function sendRow(): Promise<{ status: string; lastEventAt: Date | null }> {
  const { rows } = await dbAdmin.execute<{ status: string; last_event_at: Date | null }>(sql`
    select status, last_event_at from public.email_sends where id = ${S1}`);
  expect(rows).toHaveLength(1);
  return { status: rows[0].status, lastEventAt: rows[0].last_event_at };
}

async function resetRowTo(status: string): Promise<void> {
  await dbAdmin.execute(sql`
    update public.email_sends
    set status = ${status}, last_event_at = null where id = ${S1}`);
}

describe("POST /api/webhooks/resend", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U1}, 'webhooktest@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug)
      values (${B1}, ${U1}, 'webhook-test-book')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, email)
      values (${C1}, ${B1}, 'Webhook Testee', 'testee@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.email_sends (id, contact_id, book_id, resend_id, status)
      values (${S1}, ${C1}, ${B1}, ${RESEND_ID}, 'sent')
      on conflict (id) do nothing`);
  });

  beforeEach(async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
    await resetRowTo("sent");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("updates the row to delivered on a valid signed event", async () => {
    const payload = eventPayload("email.delivered");
    const res = await post(payload, signedHeaders(payload));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    const row = await sendRow();
    expect(row.status).toBe("delivered");
    expect(row.lastEventAt).not.toBeNull();
  });

  it("rejects a bad signature with 401 and leaves the row untouched", async () => {
    const payload = eventPayload("email.delivered");
    const res = await post(payload, signedHeaders(payload, WRONG_SECRET));
    expect(res.status).toBe(401);
    expect((await sendRow()).status).toBe("sent");
  });

  it("rejects missing svix headers with 401 via the explicit guard", async () => {
    const payload = eventPayload("email.delivered");
    const partial = signedHeaders(payload);
    delete partial["svix-signature"];
    const res = await post(payload, partial);
    expect(res.status).toBe(401);
    // Pin the explicit guard's body — svix's internal rejection says
    // "invalid signature"; this must be OUR early return, not that.
    expect(await res.text()).toBe("missing signature headers");
    expect((await post(payload, {})).status).toBe(401);
    expect((await sendRow()).status).toBe("sent");
  });

  it("rejects oversized bodies with 413 before any signature work", async () => {
    const big = JSON.stringify({
      type: "email.delivered",
      data: { email_id: RESEND_ID, junk: "x".repeat(70 * 1024) },
    });
    const res = await post(big, signedHeaders(big));
    expect(res.status).toBe(413);
    expect((await sendRow()).status).toBe("sent");
    // Declared-length path: small body, lying oversized header
    const payload = eventPayload("email.delivered");
    const res2 = await post(payload, {
      ...signedHeaders(payload),
      "content-length": String(10 * 1024 * 1024),
    });
    expect(res2.status).toBe(413);
  });

  it("returns 500 (not a silent 200) when the secret is unconfigured", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = eventPayload("email.delivered");
    const res = await post(payload, signedHeaders(payload));
    expect(res.status).toBe(500);
    expect(error).toHaveBeenCalledOnce();
    expect((await sendRow()).status).toBe("sent");
  });

  it("acks unknown event types (incl. email.sent) without touching the row", async () => {
    for (const type of ["email.sent", "email.clicked", "contact.created"]) {
      const payload = eventPayload(type);
      const res = await post(payload, signedHeaders(payload));
      expect(res.status).toBe(200);
    }
    expect((await sendRow()).status).toBe("sent");
  });

  it("acks a malformed-but-correctly-signed payload with 200 and a log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of [
      JSON.stringify({ type: "email.delivered" }), // no data
      JSON.stringify({ type: "email.delivered", data: {} }), // no email_id
      JSON.stringify({ data: { email_id: RESEND_ID } }), // no type
    ]) {
      const res = await post(bad, signedHeaders(bad));
      expect(res.status).toBe(200);
    }
    expect(warn).toHaveBeenCalledTimes(3);
    expect((await sendRow()).status).toBe("sent");
  });

  it("precedence: a late delivered never regresses opened", async () => {
    const opened = eventPayload("email.opened");
    await post(opened, signedHeaders(opened));
    expect((await sendRow()).status).toBe("opened");

    const lateDelivered = eventPayload("email.delivered");
    const res = await post(lateDelivered, signedHeaders(lateDelivered));
    expect(res.status).toBe(200); // still acked
    expect((await sendRow()).status).toBe("opened");
  });

  it("precedence: bounced is terminal — delivered/opened cannot regress it", async () => {
    const bounced = eventPayload("email.bounced");
    await post(bounced, signedHeaders(bounced));
    expect((await sendRow()).status).toBe("bounced");

    for (const type of ["email.delivered", "email.opened"]) {
      const payload = eventPayload(type);
      expect((await post(payload, signedHeaders(payload))).status).toBe(200);
      expect((await sendRow()).status).toBe("bounced");
    }
  });

  it("precedence: opened overwrites delivered; bounced overwrites opened", async () => {
    for (const [type, expected] of [
      ["email.delivered", "delivered"],
      ["email.opened", "opened"],
      ["email.bounced", "bounced"],
    ] as const) {
      const payload = eventPayload(type);
      await post(payload, signedHeaders(payload));
      expect((await sendRow()).status).toBe(expected);
    }
  });

  it("acks an old event for an unknown email_id with 200", async () => {
    const payload = eventPayload("email.delivered", "re_no_such_send_ever", ELEVEN_MINUTES_AGO());
    const res = await post(payload, signedHeaders(payload));
    expect(res.status).toBe(200);
    expect((await sendRow()).status).toBe("sent");
  });

  it("acks an event with no created_at for an unknown email_id with 200", async () => {
    const payload = JSON.stringify({ type: "email.delivered", data: { email_id: "re_no_such_send_ever" } });
    const res = await post(payload, signedHeaders(payload));
    expect(res.status).toBe(200);
  });

  it("asks Resend to retry a recent event that arrives before its send is recorded", async () => {
    const EARLY = "re_test_webhook_early";
    const S2 = "30000000-0000-0000-0000-00000000e002";
    await dbAdmin.execute(sql`delete from public.email_sends where id = ${S2}`);
    try {
      const payload = eventPayload("email.delivered", EARLY);
      expect((await post(payload, signedHeaders(payload))).status).toBe(503);

      await dbAdmin.execute(sql`
        insert into public.email_sends (id, contact_id, book_id, resend_id, status)
        values (${S2}, ${C1}, ${B1}, ${EARLY}, 'sent')`);
      expect((await post(payload, signedHeaders(payload))).status).toBe(200);
      const { rows } = await dbAdmin.execute<{ status: string }>(sql`
        select status from public.email_sends where id = ${S2}`);
      expect(rows[0].status).toBe("delivered");
    } finally {
      await dbAdmin.execute(sql`delete from public.email_sends where id = ${S2}`);
    }
  });

  it("acks a recent event that precedence ignores, without asking for a retry", async () => {
    await resetRowTo("opened");
    const payload = eventPayload("email.delivered");
    const res = await post(payload, signedHeaders(payload));
    expect(res.status).toBe(200);
    expect((await sendRow()).status).toBe("opened");
  });
});
