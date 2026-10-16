"use server";

import { redirect } from "next/navigation";
import { authConfirmationUrl } from "@/lib/auth-flow";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { logDbError } from "@/lib/log";
import { currentRequestOrigin } from "@/lib/request-origin";
import { hashedRateLimitKey, requestIp } from "@/lib/request-ip";
import { createClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { parseEmailField } from "@/lib/validation/email";
import { WAITLIST_REJECTION } from "@/lib/waitlist";

export type RequestAccessState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

// Approved, existing and waitlisted emails all get the same "sent" state;
// a different response would reveal whether an email has an account.
export async function requestAccess(
  _prevState: RequestAccessState,
  formData: FormData,
): Promise<RequestAccessState> {
  const email = parseEmailField(formData);
  if (!email) {
    return { status: "error", message: "Enter a valid email address." };
  }
  const ip = await requestIp();

  // Supabase sends at most 30 auth emails an hour for the whole project, so
  // one client or one address must not be able to use them all. The email
  // limit runs after Turnstile: otherwise anyone could use up a victim's budget.
  const ipLimit = await withinLimit(hashedRateLimitKey("request-access", ip), 5);
  if (ipLimit !== true) return ipLimit;

  const turnstileResponse = String(formData.get("cf-turnstile-response") ?? "");
  if (!(await verifyTurnstile(turnstileResponse, ip))) {
    return { status: "error", message: "Verification failed. Please try again." };
  }

  const emailLimit = await withinLimit(hashedRateLimitKey("request-access-email", email.toLowerCase()), 3);
  if (emailLimit !== true) return emailLimit;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authConfirmationUrl(process.env.APP_URL!) },
  });
  // Every send failure must look like success: only approved and existing
  // emails are ever sent mail, so an error here would reveal them.
  if (error?.status === 429) {
    console.warn(`[ra] [requestAccess] Supabase rate-limited the send: ${error.code ?? ""}`);
  } else if (error && error.message !== WAITLIST_REJECTION) {
    console.error(`[ra] [requestAccess] signInWithOtp failed: ${error.name} ${error.status ?? ""}`);
  }
  return { status: "sent", email };
}

async function withinLimit(key: string, max: number): Promise<true | RequestAccessState> {
  try {
    if (await checkRateLimit(key, max, 3600)) return true;
  } catch (err) {
    logDbError("[ra] [requestAccess] rate-limit check failed", err);
    return { status: "error", message: GENERIC_ERROR };
  }
  return { status: "error", message: "Too many requests. Please try again later." };
}

export async function continueWithGoogle() {
  const supabase = await createClient();
  const origin = await currentRequestOrigin();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: authConfirmationUrl(origin) },
  });
  if (error || !data.url) redirect("/?error=1");
  redirect(data.url);
}
