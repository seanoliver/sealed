/** Drops every query string and the /u/<token> segment: sign-in links carry token_hash and update links a bearer token. */
export function redactAnalyticsUrl(raw: string): string {
  const url = new URL(raw);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/^\/u\/(?!thanks(?:\/|$))[^/]+/, "/u/[token]");
  return url.toString();
}
