import "server-only";

export const UPDATE_TOKEN_COOKIE = "sealed_update_token";

export const UPDATE_FORM_PATH = "/u/edit";

const COOKIE_MAX_AGE_SECONDS = 60 * 60;

export function updateTokenCookieOptions({ secure }: { secure: boolean }) {
  return {
    httpOnly: true,
    // Strict would drop the cookie on the redirect that follows the email click.
    sameSite: "lax" as const,
    secure,
    path: "/u",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}
