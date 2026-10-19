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

/** Positional. `unknown`: Resend may have accepted the email but never confirmed it. */
export type SendResult =
  | { status: "sent"; id: string; to: string }
  | { status: "failed" | "unknown"; id: null; to: string };

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

type BatchError = { name: string; message: string; statusCode?: number | null };

// Quota errors are also 429s but will not clear on retry.
const RETRYABLE = new Set([
  "rate_limit_exceeded",
  "concurrent_idempotent_requests",
]);
const isRetryable = (error: BatchError) =>
  isAmbiguous(error) || RETRYABLE.has(error.name);
const isAmbiguous = (error: BatchError) =>
  error.statusCode == null || error.statusCode >= 500;

type Outcome = DistributiveOmit<SendResult, "to">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DOMException("batch send timed out", "TimeoutError")),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send address-request emails via Resend's batch API, chunked to its
 * 100-email limit. Results map positionally onto `items`. Permissive
 * validation means one rejected address fails only its own email.
 *
 * Logging safety: the html/text bodies contain personal token URLs and are
 * NEVER logged in real mode. The non-production EMAIL_DRY_RUN=1 path logs
 * the bare link (developers need it to exercise /u/[token]) and sends nothing.
 */
export async function sendAddressRequests(
  items: EmailItem[],
  {
    batchKey,
    retryDelaysMs = [1000, 2000, 4000],
    attemptTimeoutMs = 20_000,
    budgetMs = 240_000,
  }: {
    batchKey: string;
    retryDelaysMs?: number[];
    attemptTimeoutMs?: number;
    /** Stays under the dashboard's maxDuration so bookkeeping still runs. */
    budgetMs?: number;
  },
): Promise<SendResult[]> {
  if (isEmailDryRun()) {
    return items.map((item) => {
      // Dev-only: surface the tokenized link so it can be opened locally.
      const url = item.text.match(/https?:\/\/\S+/)?.[0] ?? "<no url found>";
      console.info(`[em] [dry-run] address request to ${item.to}: ${url}`);
      return {
        status: "sent",
        id: `dry_${dryRunCounter++}_${randomBytes(4).toString("hex")}`,
        to: item.to,
      };
    });
  }

  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set");
  const resend = getClient();

  const deadline = Date.now() + budgetMs;
  const results: SendResult[] = [];
  for (let start = 0; start < items.length; start += BATCH_LIMIT) {
    const chunk = items.slice(start, start + BATCH_LIMIT);
    const payload = chunk.map((item) => ({
      from,
      to: item.to,
      subject: item.subject,
      html: item.html,
      text: item.text,
    }));
    const idempotencyKey = `${batchKey}/${start / BATCH_LIMIT}`;
    let outcome: Outcome[] = [];
    let ambiguous = false;
    const giveUp = () =>
      chunk.map((): Outcome => ({
        status: ambiguous ? "unknown" : "failed",
        id: null,
      }));
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        outcome = giveUp();
        break;
      }
      let error: BatchError;
      try {
        const response = await withTimeout(
          resend.batch.send(payload, {
            batchValidation: "permissive",
            idempotencyKey,
          }),
          Math.min(attemptTimeoutMs, remaining),
        );
        if (!response.error) {
          outcome = attributeIds(chunk.length, response.data);
          break;
        }
        error = response.error;
      } catch (err) {
        // Log only the error type, never the payload.
        error = {
          name: err instanceof Error ? err.name : typeof err,
          message: "threw",
          statusCode: null,
        };
      }
      console.error(
        `[em] [sendAddressRequests] batch attempt ${attempt + 1} failed: ${error.name} ${error.statusCode ?? "-"} ${error.message}`,
      );
      ambiguous ||= isAmbiguous(error);
      if (!isRetryable(error) || attempt >= retryDelaysMs.length) {
        outcome = giveUp();
        break;
      }
      await sleep(retryDelaysMs[attempt]);
    }
    chunk.forEach((item, i) => results.push({ ...outcome[i], to: item.to }));
  }
  return results;
}

// `errors` names rejected indexes and `data` holds accepted ids in request order.
function attributeIds(
  size: number,
  data: {
    data: { id: string }[];
    errors?: { index: number; message: string }[];
  },
): Outcome[] {
  const rejected = new Set((data.errors ?? []).map((e) => e.index));
  for (const e of data.errors ?? []) {
    console.error(
      `[em] [sendAddressRequests] email ${e.index} rejected: ${e.message}`,
    );
  }
  const accepted = Array.from({ length: size }, (_, i) => i).filter(
    (i) => !rejected.has(i),
  );
  const aligned = accepted.length === data.data.length;
  if (!aligned) {
    console.error(
      `[em] [sendAddressRequests] ${data.data.length} ids for ${accepted.length} accepted emails`,
    );
  }
  const out: Outcome[] = Array.from({ length: size }, () => ({
    status: "unknown",
    id: null,
  }));
  accepted.forEach((index, n) => {
    if (aligned) out[index] = { status: "sent", id: data.data[n].id };
  });
  rejected.forEach((index) => (out[index] = { status: "failed", id: null }));
  return out;
}

/**
 * Single transactional notification (e.g. "new submission" to a book owner).
 * Swallows send failures after logging name/message only — notifications are
 * fire-and-forget and must never fail the flow that triggered them. Resolves
 * true when the email was accepted (or logged in dry-run). The
 * subject/body must never contain recipient-submitted data (the dry-run path
 * logs the subject).
 */
export async function sendNotification(item: EmailItem): Promise<boolean> {
  if (isEmailDryRun()) {
    console.info(`[em] [dry-run] notification to ${item.to}: ${item.subject}`);
    return true;
  }

  const from = process.env.EMAIL_FROM;
  if (!from) {
    console.error("[em] [sendNotification] EMAIL_FROM is not set");
    return false;
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
      return false;
    }
    return true;
  } catch (err) {
    // Transport failure. Log only the error type — never the payload.
    console.error(
      `[em] [sendNotification] send threw: ${err instanceof Error ? err.name : typeof err}`,
    );
    return false;
  }
}
