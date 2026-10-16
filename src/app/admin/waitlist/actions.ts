"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { signInLinkUrl } from "@/lib/auth-flow";
// dbAdmin is allowlisted for this file: every action must call requireAdmin first.
import { dbAdmin } from "@/lib/db/admin";
import { sendNotification } from "@/lib/email/resend";
import { waitlistApprovedEmail } from "@/lib/email/templates";
import { requiredEnv } from "@/lib/env";
import { logDbError } from "@/lib/log";
import { createAdminAuthClient } from "@/lib/supabase/admin";
import { parseEmailField } from "@/lib/validation/email";

export type ApproveState = { message?: string; error?: string; email?: string };

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
  // Only the direct form refills its input; a row's hidden email must not land there.
  const echo = formData.get("source") === "direct" ? { email: String(formData.get("email") ?? "") } : {};
  const email = parseEmailField(formData);
  if (!email) return { error: "Enter a valid email address.", ...echo };

  let newlyApproved = false;
  try {
    const rows = await dbAdmin.execute(
      sql`select private.approve_waitlist_email(${email}) as approved`,
    );
    newlyApproved = rows[0]?.approved === true;
  } catch (err) {
    logDbError("[wl] [approveEmail] approve failed", err);
    return { error: "Could not approve that email.", ...echo };
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
    : { error: `${approved}, but the invitation email failed. Use Resend invitation to try again.`, ...echo };
}

// generateLink sends no email of its own, so invitations do not use Supabase's
// hourly auth email limit. Do not switch to signInWithOtp or inviteUserByEmail.
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
