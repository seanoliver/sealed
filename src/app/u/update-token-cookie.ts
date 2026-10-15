import "server-only";
import { createHash } from "node:crypto";

export const UPDATE_FORM_PATH = "/u/edit";

const COOKIE_PREFIX = "sealed_update_";

const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

export const REF_SHAPE = /^[0-9a-f]{16}$/;

// Prefixed so the ref never equals a prefix of the stored token hash.
export function tokenRef(token: string): string {
  return createHash("sha256")
    .update(`update-form:${token}`)
    .digest("hex")
    .slice(0, 16);
}

export function updateTokenCookieName(ref: string): string {
  return `${COOKIE_PREFIX}${ref}`;
}

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

type CookieReader = { get(name: string): { value: string } | undefined };

/** The token behind `ref`, or null when this browser holds none for it. */
export function readUpdateToken(cookies: CookieReader, ref: string): string | null {
  if (!REF_SHAPE.test(ref)) return null;
  const token = cookies.get(updateTokenCookieName(ref))?.value;
  return token && tokenRef(token) === ref ? token : null;
}
