"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs): the waitlist is
// reachable only through private.* functions, and requireAdmin gates every call.
import { dbAdmin } from "@/lib/db/admin";
import { sendNotification } from "@/lib/email/resend";
import { waitlistApprovedEmail } from "@/lib/email/templates";
import { logDbError } from "@/lib/log";

export type ApproveState = { message?: string; error?: string };

const emailSchema = z.email().max(254);

// Approves any email, listed or not. Re-running for an approved email resends the invitation.
export async function approveEmail(
  _prevState: ApproveState,
  formData: FormData,
): Promise<ApproveState> {
  await requireAdmin();
  const parsed = emailSchema.safeParse(
    String(formData.get("email") ?? "").trim().toLowerCase(),
  );
  if (!parsed.success) return { error: "Enter a valid email address." };
  const email = parsed.data;

  try {
    await dbAdmin.execute(sql`select private.approve_waitlist_email(${email})`);
  } catch (err) {
    logDbError("[wl] [approveEmail] approve failed", err);
    return { error: "Could not approve that email." };
  }

  const sent = await sendNotification({
    to: email,
    ...waitlistApprovedEmail({ signInUrl: `${process.env.APP_URL}/` }),
  });
  if (sent) {
    try {
      await dbAdmin.execute(sql`select private.mark_waitlist_invite_sent(${email})`);
    } catch (err) {
      logDbError("[wl] [approveEmail] mark invite sent failed", err);
    }
  }
  revalidatePath("/admin/waitlist");
  return sent
    ? { message: `Approved ${email} and sent the invitation.` }
    : { error: `Approved ${email}, but the invitation email failed. Try again to resend it.` };
}
