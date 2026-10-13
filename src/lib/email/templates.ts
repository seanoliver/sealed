import { TOKEN_TTL_DAYS } from "@/lib/tokens";

/**
 * Address-request email. Deliberately contains NO recipient data (no current
 * address echo) — the personal link is the only sensitive content, and it
 * lets the recipient view/update their own details behind the token.
 */

/** User-controlled values must be escaped before HTML interpolation. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface AddressRequestEmailInput {
  ownerName: string;
  updateUrl: string;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function addressRequestEmail({
  ownerName,
  updateUrl,
}: AddressRequestEmailInput): EmailContent {
  // Strip control chars (CR/LF included) from the user-controlled name before
  // it enters the subject line. Resend's JSON API can't be header-injected,
  // but that guarantee shouldn't be outsourced to the transport.
  const safeOwnerName = ownerName.replace(/\p{Cc}+/gu, " ").trim();
  const subject = `${safeOwnerName} would like your current mailing address · Sealed`;

  const owner = escapeHtml(safeOwnerName);
  const url = escapeHtml(updateUrl);

  // Minimal single-column HTML: inline styles only, no images, no tracking.
  const html = `<div style="margin:0 auto;max-width:520px;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.6">
  <p style="margin:0 0 24px;font-size:17px;font-weight:700">Sealed</p>
  <p style="margin:0 0 16px">Hi,</p>
  <p style="margin:0 0 16px">${owner} is updating their address book and would like to make sure your mailing address is current.</p>
  <p style="margin:0 0 24px">It takes less than a minute — confirm or update your details here:</p>
  <p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Update my address</a></p>
  <p style="margin:0 0 16px;color:#6b7280;font-size:13px">This link is personal to you — please don&#39;t forward it. It expires in ${TOKEN_TTL_DAYS} days.</p>
  <p style="margin:0;color:#6b7280;font-size:13px">If the button doesn&#39;t work, copy and paste this address into your browser:<br>${url}</p>
</div>`;

  const text = `Sealed

Hi,

${safeOwnerName} is updating their address book and would like to make sure your mailing address is current.

It takes less than a minute — confirm or update your details here:

${updateUrl}

This link is personal to you — please don't forward it. It expires in ${TOKEN_TTL_DAYS} days.
`;

  return { subject, html, text };
}

export interface SubmissionNotificationEmailInput {
  reviewUrl: string;
}

/**
 * Owner notification for a new permalink submission. Deliberately contains
 * ZERO submitted data — not the name, not the email, not whether it matched
 * an existing contact. Just the fact that something is waiting for review.
 */
export function submissionNotificationEmail({
  reviewUrl,
}: SubmissionNotificationEmailInput): EmailContent {
  const subject = "New address submission · Sealed";
  const url = escapeHtml(reviewUrl);

  const html = `<div style="margin:0 auto;max-width:520px;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.6">
  <p style="margin:0 0 24px;font-size:17px;font-weight:700">Sealed</p>
  <p style="margin:0 0 16px">Hi,</p>
  <p style="margin:0 0 16px">Someone added their info through your public link. It&#39;s waiting in your review queue.</p>
  <p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Review it</a></p>
  <p style="margin:0;color:#6b7280;font-size:13px">If the button doesn&#39;t work, copy and paste this address into your browser:<br>${url}</p>
</div>`;

  const text = `Sealed

Hi,

Someone added their info through your public link. It's waiting in your review queue.

Review it: ${reviewUrl}
`;

  return { subject, html, text };
}

export interface HealthCheckFailedEmailInput {
  environment: string;
  checkedAt: Date;
}

/** No error details here: driver messages carry connection info. */
export function healthCheckFailedEmail({
  environment,
  checkedAt,
}: HealthCheckFailedEmailInput): EmailContent {
  const safeEnvironment = environment.replace(/\p{Cc}+/gu, " ").trim();
  const subject = `Database health check failed (${safeEnvironment}) · Sealed`;
  const when = checkedAt.toISOString();
  const env = escapeHtml(safeEnvironment);

  const html = `<div style="margin:0 auto;max-width:520px;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.6">
  <p style="margin:0 0 24px;font-size:17px;font-weight:700">Sealed</p>
  <p style="margin:0 0 16px">The scheduled database health check failed in <strong>${env}</strong> at ${when}.</p>
  <p style="margin:0 0 16px">Check whether the Supabase project is paused or down, and search the Vercel runtime logs for <code>[hc] [health]</code>.</p>
  <p style="margin:0;color:#6b7280;font-size:13px">This alert contains no error details by design.</p>
</div>`;

  const text = `Sealed

The scheduled database health check failed in ${safeEnvironment} at ${when}.

Check whether the Supabase project is paused or down, and search the Vercel runtime logs for [hc] [health].

This alert contains no error details by design.
`;

  return { subject, html, text };
}
