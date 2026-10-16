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
  | { status: "error"; message: string; email?: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";
const VERIFICATION_FAILED = "Verification failed. Please try again.";

export async function requestAccess(
  _prevState: RequestAccessState,
  formData: FormData,
): Promise<RequestAccessState> {
  // React 19 resets uncontrolled inputs after an action, so errors echo the email back.
  const typed = String(formData.get("email") ?? "");
  const fail = (message: string): RequestAccessState => ({ status: "error", message, email: typed });
  const email = parseEmailField(formData);
  if (!email) return fail("Enter a valid email address.");
  const turnstileResponse = String(formData.get("cf-turnstile-response") ?? "");
  // Checked before the IP limit so a submit that beat the widget costs no budget.
  if (!turnstileResponse) return fail(VERIFICATION_FAILED);
  const ip = await requestIp();

  // The email limit must run after Turnstile, or a bot could use up any address's budget.
  const ipLimited = await limitError(hashedRateLimitKey("request-access", ip), 5);
  if (ipLimited) return fail(ipLimited);

  if (!(await verifyTurnstile(turnstileResponse, ip))) return fail(VERIFICATION_FAILED);

  const emailLimited = await limitError(
    hashedRateLimitKey("request-access-email", email.toLowerCase()),
    3,
  );
  if (emailLimited) return fail(emailLimited);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authConfirmationUrl(process.env.APP_URL!) },
  });
  // Every send failure must look like success: only approved and existing
  // emails are ever sent mail, so an error here would reveal them.
  if (error && error.message !== WAITLIST_REJECTION) {
    console.error(
      `[ra] [requestAccess] signInWithOtp failed: ${error.name} ${error.status ?? ""} ${error.code ?? ""}`.trimEnd(),
    );
  }
  return { status: "sent", email };
}

async function limitError(key: string, max: number): Promise<string | null> {
  try {
    if (await checkRateLimit(key, max, 3600)) return null;
  } catch (err) {
    logDbError("[ra] [requestAccess] rate-limit check failed", err);
    return GENERIC_ERROR;
  }
  return "Too many requests. Please try again later.";
}

export async function continueWithGoogle() {
  const supabase = await createClient();
  const origin = await currentRequestOrigin();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: authConfirmationUrl(origin) },
  });
  if (error || !data.url) redirect("/?error=oauth");
  redirect(data.url);
}
