import "server-only";

/**
 * The emailed link is /u/<token>, and platform request logs (Vercel) record
 * every request path. GET /u/[token] therefore trades the token for this
 * cookie and redirects to UPDATE_FORM_PATH, so the raw token appears in at
 * most one logged request; the form page and its submit read the cookie.
 * See docs/bugs/2026-10-14-update-tokens-in-request-logs.md.
 */
export const UPDATE_TOKEN_COOKIE = "sealed_update_token";

/** The token-free URL the recipient form lives at. */
export const UPDATE_FORM_PATH = "/u/edit";

/**
 * Long enough to fill in the form; short because the emailed link still
 * works until the token is used or expires, so re-clicking it starts over.
 */
const COOKIE_MAX_AGE_SECONDS = 60 * 60;

export function updateTokenCookieOptions({ secure }: { secure: boolean }) {
  return {
    httpOnly: true,
    // Lax, not Strict: the cookie is set on the response to a cross-site
    // navigation (the email client), and Strict would drop it on the
    // redirect that immediately follows.
    sameSite: "lax" as const,
    secure,
    // Only the recipient surface ever needs it.
    path: "/u",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}
