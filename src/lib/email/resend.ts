import "server-only";
import { randomBytes } from "node:crypto";
import { Resend } from "resend";
import { isProductionEnvironment } from "@/lib/app-env";

export interface EmailItem {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Positional result: `id` is Resend's email id, or null when the send failed. */
export interface SendResult {
  id: string | null;
  to: string;
}

/** Resend's batch endpoint accepts at most 100 emails per call. */
const BATCH_LIMIT = 100;

// Counter for readable dry-run ids. The random suffix keeps ids unique across
// dev-server restarts/HMR module reloads — email_sends.resend_id is UNIQUE,
// so a repeated "dry_0" would fail the insert on the second run.
let dryRunCounter = 0;

/**
 * Dry-run predicate, shared with requestAddresses' up-front env validation.
 * APP_ENV-gated because every Vercel deployment runs with NODE_ENV=production.
 * A stray EMAIL_DRY_RUN=1 can never suppress real production sends.
 */
export function isEmailDryRun(): boolean {
  return process.env.EMAIL_DRY_RUN === "1" && !isProductionEnvironment();
}

let client: Resend | undefined;
function getClient(): Resend {
  if (!client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    client = new Resend(key);
  }
  return client;
}

/**
 * Send address-request emails via Resend's batch API, chunked to its
 * 100-email limit. Results map positionally onto `items`; a failed chunk
 * yields `id: null` for each of its items (partial failure tolerated —
 * the caller decides what to do with the unsent tokens).
 *
 * Logging safety: the html/text bodies contain personal token URLs and are
 * NEVER logged in real mode. The non-production EMAIL_DRY_RUN=1 path logs
 * the bare link (developers need it to exercise /u/[token]) and sends nothing.
 */
export async function sendAddressRequests(
  items: EmailItem[],
): Promise<SendResult[]> {
  if (isEmailDryRun()) {
    return items.map((item) => {
      // Dev-only: surface the tokenized link so it can be opened locally.
      const url = item.text.match(/https?:\/\/\S+/)?.[0] ?? "<no url found>";
      console.info(`[em] [dry-run] address request to ${item.to}: ${url}`);
      return {
        id: `dry_${dryRunCounter++}_${randomBytes(4).toString("hex")}`,
        to: item.to,
      };
    });
  }

  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set");
  const resend = getClient();

  const results: SendResult[] = [];
  for (let start = 0; start < items.length; start += BATCH_LIMIT) {
    const chunk = items.slice(start, start + BATCH_LIMIT);
    let ids: (string | null)[];
    try {
      const { data, error } = await resend.batch.send(
        chunk.map((item) => ({
          from,
          to: item.to,
          subject: item.subject,
          html: item.html,
          text: item.text,
        })),
      );
      if (error) {
        // Resend's own error message — names/codes only, no email bodies.
        console.error(
          `[em] [sendAddressRequests] batch failed: ${error.name} ${error.message}`,
        );
        ids = chunk.map(() => null);
      } else {
        // Map ids positionally; null-fill defensively if counts mismatch.
        ids = chunk.map((_, i) => data.data[i]?.id ?? null);
      }
    } catch (err) {
      // Transport failure. Log only the error type — never the payload.
      console.error(
        `[em] [sendAddressRequests] batch threw: ${err instanceof Error ? err.name : typeof err}`,
      );
      ids = chunk.map(() => null);
    }
    for (let i = 0; i < chunk.length; i++) {
      results.push({ id: ids[i], to: chunk[i].to });
    }
  }
  return results;
}

/**
 * Single transactional notification (e.g. "new submission" to a book owner).
 * Swallows send failures after logging name/message only — notifications are
 * fire-and-forget and must never fail the flow that triggered them. The
 * subject/body must never contain recipient-submitted data (the dry-run path
 * logs the subject).
 */
export async function sendNotification(item: EmailItem): Promise<void> {
  if (isEmailDryRun()) {
    console.info(`[em] [dry-run] notification to ${item.to}: ${item.subject}`);
    return;
  }

  const from = process.env.EMAIL_FROM;
  if (!from) {
    console.error("[em] [sendNotification] EMAIL_FROM is not set");
    return;
  }

  try {
    const { error } = await getClient().emails.send({
      from,
      to: item.to,
      subject: item.subject,
      html: item.html,
      text: item.text,
    });
    if (error) {
      // Resend's own error message — names/codes only, no email bodies.
      console.error(
        `[em] [sendNotification] send failed: ${error.name} ${error.message}`,
      );
    }
  } catch (err) {
    // Transport failure. Log only the error type — never the payload.
    console.error(
      `[em] [sendNotification] send threw: ${err instanceof Error ? err.name : typeof err}`,
    );
  }
}
