import { and, eq, inArray, sql } from "drizzle-orm";
import { Webhook } from "svix";
import { z } from "zod";
// Sanctioned dbAdmin call site (see eslint.config.mjs): webhook status
// updates key on resend_id, which no RLS policy exposes — there is no
// user session here, only a svix signature.
import { dbAdmin } from "@/lib/db/admin";
import { emailSends } from "@/lib/db/schema";

/**
 * Statuses a webhook event can move a send TO. "sent" is only ever the
 * insert-time default — no event maps to it (email.sent is ignored below
 * because the row is created as 'sent' when the batch call returns).
 */
type WebhookStatus = "delivered" | "opened" | "bounced" | "complained";

const EVENT_TO_STATUS: Record<string, WebhookStatus | undefined> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

/**
 * Status precedence: sent < delivered < opened < bounced/complained
 * (terminal). Resend retries and out-of-order delivery mean a late
 * "delivered" can arrive after "opened" — each incoming status may only
 * overwrite the statuses listed here (strictly lower precedence), so:
 * - a late "delivered" never regresses "opened"
 * - nothing ever regresses "bounced"/"complained" (absent from every list)
 */
const OVERWRITES: Record<WebhookStatus, string[]> = {
  delivered: ["sent"],
  opened: ["sent", "delivered"],
  bounced: ["sent", "delivered", "opened"],
  complained: ["sent", "delivered", "opened"],
};

/**
 * The shape we consume from a verified Resend event. Deliberately loose —
 * extra keys are ignored; we only need the type and the email id.
 */
const ResendEvent = z.object({
  type: z.string(),
  created_at: z.string().optional(),
  data: z.object({ email_id: z.string() }),
});

/**
 * requestAddresses records a send only after Resend accepts the batch, so an
 * early event can arrive first. Resend retries a non-2xx after 5s and 5min.
 */
const AWAIT_SEND_RECORD_MS = 10 * 60 * 1000;

function isRecent(createdAt: string | undefined, now = Date.now()): boolean {
  const at = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(at) && now - at < AWAIT_SEND_RECORD_MS;
}

export async function POST(req: Request) {
  try {
    // Size guard: Resend events are ~1KB; self-hosted deployments have no
    // platform body cap, so never HMAC megabytes of unauthenticated input.
    // Declared length is checked before buffering; actual length after
    // (covers chunked bodies and lying Content-Length headers).
    const MAX_BODY_BYTES = 64 * 1024;
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return new Response("payload too large", { status: 413 });
    }

    // Raw body FIRST, before any parsing — svix verifies the exact bytes.
    const payload = await req.text();
    if (payload.length > MAX_BODY_BYTES) {
      return new Response("payload too large", { status: 413 });
    }

    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      // Misconfiguration must be loud: a silent 200 would let Resend mark
      // every event delivered while we drop them all.
      console.error("[wh] [resend] RESEND_WEBHOOK_SECRET is not set");
      return new Response("server misconfigured", { status: 500 });
    }

    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");
    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response("missing signature headers", { status: 401 });
    }

    let verified: unknown;
    try {
      verified = new Webhook(secret).verify(payload, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      return new Response("invalid signature", { status: 401 });
    }

    const parsed = ResendEvent.safeParse(verified);
    if (!parsed.success) {
      // Correctly signed but not the shape we expect (Resend schema drift).
      // Ack with 200 — a non-2xx would make Resend retry-storm an event we
      // will never be able to parse. Log the drift; never log the payload.
      console.warn("[wh] [resend] verified payload failed shape validation");
      return new Response("ok");
    }
    const event = parsed.data;

    const status = EVENT_TO_STATUS[event.type];
    if (!status) {
      // Includes email.sent (row already inserted as 'sent') and any event
      // types we don't track. Ack so Resend doesn't retry.
      return new Response("ok");
    }

    // Precedence-guarded update (see OVERWRITES).
    const updated = await dbAdmin
      .update(emailSends)
      .set({ status, lastEventAt: sql`now()` })
      .where(
        and(
          eq(emailSends.resendId, event.data.email_id),
          inArray(emailSends.status, OVERWRITES[status]),
        ),
      )
      .returning({ id: emailSends.id });
    if (updated.length > 0) return new Response("ok");

    // 0 rows: either precedence kept a later status (ack), or the send isn't
    // recorded yet. A recent event for an unrecorded send gets a retryable
    // 503; an old one is from a failed send or another environment (ack).
    const [known] = await dbAdmin
      .select({ id: emailSends.id })
      .from(emailSends)
      .where(eq(emailSends.resendId, event.data.email_id))
      .limit(1);
    if (!known && isRecent(event.created_at)) {
      return new Response("send not recorded yet", { status: 503 });
    }
    return new Response("ok");
  } catch (err) {
    // Never throw unhandled; log only the error type — never the payload.
    console.error(
      `[wh] [resend] unhandled: ${err instanceof Error ? err.name : typeof err}`,
    );
    return new Response("internal error", { status: 500 });
  }
}
