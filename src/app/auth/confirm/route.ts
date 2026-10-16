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
 * On success the session cookies are set and we land on /dashboard.
 * Failures land on /?error=oauth for Google and /?error=1 for email links.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = otpTypeSchema.safeParse(searchParams.get("type"));
  const code = searchParams.get("code");

  if (searchParams.get("error_description") === WAITLIST_REJECTION) {
    return NextResponse.redirect(new URL("/?requested=google", request.url));
  }
  // Email links always carry a token_hash, so a provider error or a code is Google.
  if (searchParams.get("error")) {
    return NextResponse.redirect(new URL("/?error=oauth", request.url));
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
    return NextResponse.redirect(new URL(error ? "/?error=oauth" : "/dashboard", request.url));
  }

  return NextResponse.redirect(new URL("/?error=1", request.url));
}
