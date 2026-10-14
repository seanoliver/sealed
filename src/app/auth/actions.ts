"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authConfirmationUrl } from "@/lib/auth-flow";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { logDbError } from "@/lib/log";
import { currentRequestOrigin } from "@/lib/request-origin";
import { hashedIpKey, requestIp } from "@/lib/request-ip";
import { createClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { WAITLIST_REJECTION } from "@/lib/waitlist";

const emailSchema = z.email().max(254);

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
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  if (!parsed.success) {
    return { status: "error", message: "Enter a valid email address." };
  }
  const email = parsed.data;
  const ip = await requestIp();

  let allowed = false;
  try {
    allowed = await checkRateLimit(hashedIpKey("request-access", ip), 30, 3600);
  } catch (err) {
    logDbError("[ra] [requestAccess] rate-limit check failed", err);
    return { status: "error", message: GENERIC_ERROR };
  }
  if (!allowed) {
    return { status: "error", message: "Too many requests. Please try again later." };
  }

  const turnstileResponse = String(formData.get("cf-turnstile-response") ?? "");
  if (!(await verifyTurnstile(turnstileResponse, ip))) {
    return { status: "error", message: "Verification failed. Please try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authConfirmationUrl(process.env.APP_URL!) },
  });
  if (error && error.message !== WAITLIST_REJECTION) {
    console.error(`[ra] [requestAccess] signInWithOtp failed: ${error.name} ${error.status ?? ""}`);
    return { status: "error", message: GENERIC_ERROR };
  }
  return { status: "sent", email };
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
