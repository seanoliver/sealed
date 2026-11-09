import { TOKEN_SHAPE } from "@/lib/tokens";

const RECIPIENT_ROUTE = new RegExp(`^/u/(thanks|${TOKEN_SHAPE.source.slice(1, -1)}(/confirm)?)/?$`);
const TOKEN_LIKE = /[A-Za-z0-9_-]{43}/;

/**
 * Redacts the token on the three recipient routes and drops the query and fragment. Returns
 * null, dropping the event, for any other path that could carry a token: on a 404 the
 * analytics route field holds the raw path, which beforeSend cannot rewrite.
 */
export function redactAnalyticsUrl(raw: string): string | null {
  const url = new URL(raw);
  url.search = "";
  url.hash = "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname).replace(/\/{2,}/g, "/");
  } catch {
    return null;
  }
  const recipient = /^\/u\//i.test(decoded);
  if (recipient && !RECIPIENT_ROUTE.test(url.pathname)) return null;
  if (!recipient && (TOKEN_LIKE.test(decoded) || TOKEN_LIKE.test(url.pathname))) return null;
  url.pathname = url.pathname.replace(/^\/u\/(?!thanks(?:\/|$))[^/]+/, "/u/[token]");
  return url.toString();
}
