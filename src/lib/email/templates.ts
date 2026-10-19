import { TOKEN_TTL_DAYS } from "@/lib/tokens";

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
  confirmUrl: string;
  /** What the envelope says today: the household line, then the address lines (none when missing). */
  envelope: { household: string; address: string[] | null };
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const BUTTON =
  "display:block;text-align:center;background:#2f5b86;color:#ffffff;text-decoration:none;padding:15px 20px;border-radius:10px;font-weight:600;font-size:16px";

/**
 * Address-request email: shows the envelope as it will be addressed and asks
 * whether it will arrive. It carries the recipient's own name and address,
 * so it must only ever go to that contact's email.
 */
export function addressRequestEmail({
  ownerName,
  updateUrl,
  confirmUrl,
  envelope,
}: AddressRequestEmailInput): EmailContent {
  // Strip control chars (CR/LF included) from the user-controlled name before
  // it enters the subject line. Resend's JSON API can't be header-injected,
  // but that guarantee shouldn't be outsourced to the transport.
  const safeOwnerName = ownerName.replace(/\p{Cc}+/gu, " ").trim();
  const aboutUrl = new URL("/about", updateUrl).href;
  const hasAddress = envelope.address !== null;
  const subject = hasAddress
    ? `Will ${safeOwnerName}'s holiday card reach you? · Sealed`
    : `Where should ${safeOwnerName} send your holiday card? · Sealed`;

  const owner = escapeHtml(safeOwnerName);
  const lines = [envelope.household, ...(envelope.address ?? [])].map(escapeHtml);
  const envelopeHtml = `<div style="margin:0 0 24px;background:#fffdf8;border:1px solid #ddd3c3;border-radius:6px;padding:18px 18px 26px">
    <p style="margin:0 0 22px;font-size:11px;color:#6a6157">${owner}</p>
    <p style="margin:0 0 0 48px;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.5;color:#3a332c">${lines.join("<br>")}</p>
  </div>`;
  const intro = hasAddress
    ? `${owner} is addressing holiday cards. Here&#39;s exactly how yours will look:`
    : `${owner} is addressing holiday cards and wants to send you one. Here&#39;s what&#39;s on your envelope so far:`;
  const actions = hasAddress
    ? `<p style="margin:0 0 16px;font-size:17px;font-weight:600;text-align:center">Will this reach you?</p>
  <p style="margin:0 0 10px"><a href="${escapeHtml(confirmUrl)}" style="${BUTTON}">Yes, send it here</a></p>
  <p style="margin:0 0 24px;text-align:center"><a href="${escapeHtml(updateUrl)}" style="color:#2f5b86;font-weight:600;font-size:15px">Fix a name or the address</a></p>`
    : `<p style="margin:0 0 24px"><a href="${escapeHtml(updateUrl)}" style="${BUTTON}">Add your names and address</a></p>`;

  const html = `<div style="margin:0 auto;max-width:520px;padding:24px;background:#f9f6f0;font-family:${FONT};color:#3a332c;font-size:16px;line-height:1.55">
  <p style="margin:0 0 20px">Hi, ${intro}</p>
  ${envelopeHtml}
  ${actions}
  <p style="margin:0;color:#6a6157;font-size:13px;text-align:center">Sent with <a href="${escapeHtml(aboutUrl)}" style="color:#6a6157">Sealed</a>. This link is personal to you, so please don&#39;t forward it. It expires in ${TOKEN_TTL_DAYS} days.</p>
</div>`;

  const plainLines = [envelope.household, ...(envelope.address ?? [])].map((line) => `  ${line}`).join("\n");
  const text = hasAddress
    ? `Hi, ${safeOwnerName} is addressing holiday cards. Here's exactly how yours will look:

${plainLines}

Will this reach you?

Yes, send it here: ${confirmUrl}
Fix a name or the address: ${updateUrl}

Sent with Sealed (${aboutUrl}). This link is personal to you, so please don't forward it. It expires in ${TOKEN_TTL_DAYS} days.
`
    : `Hi, ${safeOwnerName} is addressing holiday cards and wants to send you one. Here's what's on your envelope so far:

${plainLines}

Add your names and address: ${updateUrl}

Sent with Sealed (${aboutUrl}). This link is personal to you, so please don't forward it. It expires in ${TOKEN_TTL_DAYS} days.
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

export interface ContactUpdatedEmailInput {
  contactUrl: string;
}

/** Owner notification for a token update. Same rule as submissions: no recipient data. */
export function contactUpdatedEmail({ contactUrl }: ContactUpdatedEmailInput): EmailContent {
  const subject = "A contact checked their details · Sealed";
  const url = escapeHtml(contactUrl);

  const html = `<div style="margin:0 auto;max-width:520px;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.6">
  <p style="margin:0 0 24px;font-size:17px;font-weight:700">Sealed</p>
  <p style="margin:0 0 16px">Hi,</p>
  <p style="margin:0 0 16px">One of your contacts just checked their details through their personal link. Your address book already has the update.</p>
  <p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">View contact</a></p>
  <p style="margin:0;color:#6b7280;font-size:13px">If the button doesn&#39;t work, copy and paste this address into your browser:<br>${url}</p>
</div>`;

  const text = `Sealed

Hi,

One of your contacts just checked their details through their personal link. Your address book already has the update.

View contact: ${contactUrl}
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

export interface WaitlistApprovedEmailInput {
  signInUrl: string;
  appUrl: string;
}

export function waitlistApprovedEmail({
  signInUrl,
  appUrl,
}: WaitlistApprovedEmailInput): EmailContent {
  const subject = "You’re invited to Sealed";
  const url = escapeHtml(signInUrl);
  const entryUrl = escapeHtml(appUrl);

  const html = `<div style="margin:0 auto;max-width:520px;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.6">
  <p style="margin:0 0 24px;font-size:17px;font-weight:700">Sealed</p>
  <p style="margin:0 0 16px">Hi,</p>
  <p style="margin:0 0 16px">You’re in. Your invitation to the Sealed beta is ready. Use this link to sign in and create your address book.</p>
  <p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Sign in to Sealed</a></p>
  <p style="margin:0 0 16px;color:#6b7280;font-size:13px">For your security, this link stops working after a while. If it has, go to <a href="${entryUrl}" style="color:#6b7280">${entryUrl}</a> and enter this email address to get a new one.</p>
  <p style="margin:0;color:#6b7280;font-size:13px">If the button doesn&#39;t work, copy and paste this address into your browser:<br>${url}</p>
</div>`;

  const text = `Sealed

Hi,

You’re in. Your invitation to the Sealed beta is ready. Use this link to sign in and create your address book.

Sign in: ${signInUrl}

For your security, this link stops working after a while. If it has, go to ${appUrl} and enter this email address to get a new one.
`;

  return { subject, html, text };
}
