const RECIPIENT_ROUTE = /^\/u\/(thanks|[^/]+(\/confirm)?)\/?$/;

/**
 * Drops the query, fragment and /u/<token> segment, since sign-in links carry token_hash and
 * update links a bearer token. Returns null for any other /u/ path: on a 404 the analytics
 * route field carries the raw path, and beforeSend can only drop the whole event.
 */
export function redactAnalyticsUrl(raw: string): string | null {
  const url = new URL(raw);
  url.search = "";
  url.hash = "";
  if (/^\/+u\//i.test(url.pathname)) {
    if (!RECIPIENT_ROUTE.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/^\/u\/(?!thanks(?:\/|$))[^/]+/, "/u/[token]");
  }
  return url.toString();
}
