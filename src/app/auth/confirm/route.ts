import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { WAITLIST_REJECTION } from "@/lib/waitlist";

const otpTypeSchema = z.enum([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

/**
 * Auth confirmation endpoint (canonical @supabase/ssr pattern).
 * - Magic link / email OTP: ?token_hash=...&type=email → verifyOtp
 * - OAuth (Google) PKCE:    ?code=...                  → exchangeCodeForSession
 * - OAuth sign-up rejected by the waitlist hook: ?error_description=sealed_waitlisted
 * On success the session cookies are set and we land on /dashboard.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = otpTypeSchema.safeParse(searchParams.get("type"));
  const code = searchParams.get("code");

  if (searchParams.get("error_description") === WAITLIST_REJECTION) {
    return NextResponse.redirect(new URL("/?requested=google", request.url));
  }

  const supabase = await createClient();

  if (tokenHash && type.success) {
    const { error } = await supabase.auth.verifyOtp({
      type: type.data,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.redirect(new URL("/?error=1", request.url));
}
