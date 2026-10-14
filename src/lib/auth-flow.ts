/** Magic-link and OAuth callbacks land on /auth/confirm. */
export function authConfirmationUrl(baseUrl: string): string {
  const url = new URL("/auth/confirm", baseUrl);
  // The email templates append `&token_hash=…` to this URL, so it must already
  // carry a query string. /auth/confirm ignores the value.
  url.searchParams.set("flow", "login");
  return url.toString();
}
