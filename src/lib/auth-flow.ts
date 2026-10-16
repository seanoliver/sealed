/** Magic-link and OAuth callbacks land on /auth/confirm. */
export function authConfirmationUrl(baseUrl: string): string {
  const url = new URL("/auth/confirm", baseUrl);
  // The email templates append `&token_hash=…` to this URL, so it must already
  // carry a query string. /auth/confirm ignores the value.
  url.searchParams.set("flow", "login");
  return url.toString();
}

/**
 * A sign-in link we email ourselves. /auth/confirm verifies the token hash,
 * or sends the person back to the entry page when it has expired.
 */
export function signInLinkUrl(
  baseUrl: string,
  { tokenHash, type }: { tokenHash: string; type: string },
): string {
  const url = new URL("/auth/confirm", baseUrl);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  return url.toString();
}
