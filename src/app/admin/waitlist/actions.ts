"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { signInLinkUrl } from "@/lib/auth-flow";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs): the waitlist is
// reachable only through private.* functions, and requireAdmin gates every call.
import { dbAdmin } from "@/lib/db/admin";
import { sendNotification } from "@/lib/email/resend";
import { waitlistApprovedEmail } from "@/lib/email/templates";
import { requiredEnv } from "@/lib/env";
import { logDbError } from "@/lib/log";
import { createAdminAuthClient } from "@/lib/supabase/admin";
import { parseEmailField } from "@/lib/validation/email";

export type ApproveState = { message?: string; error?: string };

// Approves any email, listed or not. Re-running for an approved email resends
// the invitation with a fresh sign-in link.
export async function approveEmail(
  _prevState: ApproveState,
  formData: FormData,
): Promise<ApproveState> {
  await requireAdmin();
  // Checked before approving, so a misconfigured deploy changes nothing.
  const appUrl = requiredEnv("APP_URL");
  const authAdmin = createAdminAuthClient();
  // No lowercasing here: private.approve_waitlist_email and Supabase Auth both
  // normalize the address.
  const email = parseEmailField(formData);
  if (!email) return { error: "Enter a valid email address." };

  let newlyApproved = false;
  try {
    const rows = await dbAdmin.execute(
      sql`select private.approve_waitlist_email(${email}) as approved`,
    );
    newlyApproved = rows[0]?.approved === true;
  } catch (err) {
    logDbError("[wl] [approveEmail] approve failed", err);
    return { error: "Could not approve that email." };
  }

  const sent = await sendInvitation({ email, appUrl, authAdmin });
  if (sent) {
    try {
      await dbAdmin.execute(sql`select private.mark_waitlist_invitation_sent(${email})`);
    } catch (err) {
      logDbError("[wl] [approveEmail] mark invitation sent failed", err);
    }
  }
  revalidatePath("/admin/waitlist");
  const approved = newlyApproved ? `Approved ${email}` : `${email} was already approved`;
  return sent
    ? { message: `${approved}. Invitation sent.` }
    : { error: `${approved}, but the invitation email failed. Use Resend invitation to try again.` };
}

/**
 * Emails the invitation with a working sign-in link. generateLink creates the
 * (now approved) user if needed, so the before-user-created hook lets it
 * through, and it sends nothing itself, so it does not use Supabase's email
 * budget. The link expires after the project's OTP lifetime; /auth/confirm
 * sends an expired link back to the entry page to request a new one.
 */
async function sendInvitation({
  email,
  appUrl,
  authAdmin,
}: {
  email: string;
  appUrl: string;
  authAdmin: ReturnType<typeof createAdminAuthClient>;
}): Promise<boolean> {
  const { data, error } = await authAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) {
    console.error(`[wl] [approveEmail] generateLink failed: ${error.name} ${error.status ?? ""}`);
    return false;
  }
  const signInUrl = signInLinkUrl(appUrl, {
    tokenHash: data.properties.hashed_token,
    type: data.properties.verification_type,
  });
  return sendNotification({ to: email, ...waitlistApprovedEmail({ signInUrl, appUrl }) });
}
