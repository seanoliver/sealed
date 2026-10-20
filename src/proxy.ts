import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next 16 renamed the root `middleware` file convention to `proxy`.
export default async function proxy(request: NextRequest) {
  const fallbackCode = request.nextUrl.searchParams.get("code");

  // Supabase falls back to its configured Site URL when an OAuth redirect URL
  // is missing from the hosted allow-list. Do not strand a valid PKCE code on
  // the public homepage: hand it to the canonical confirmation endpoint.
  if (request.nextUrl.pathname === "/" && fallbackCode) {
    const confirmationUrl = request.nextUrl.clone();
    confirmationUrl.pathname = "/auth/confirm";
    confirmationUrl.search = "";
    confirmationUrl.searchParams.set("code", fallbackCode);
    return NextResponse.redirect(confirmationUrl);
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Refresh sessions everywhere EXCEPT:
     * - _next/static, _next/image, favicon.ico and static assets
     * - /b/* (public book permalinks) and /u/* (recipient update links) —
     *   privacy: no session work on recipient-facing pages
     * - /api/webhooks/* (signature-verified, no cookies)
     * - /api/health (cron health check, bearer-secret auth, no cookies)
     * - /api/mcp (agent MCP server, bearer-token auth, no cookies)
     */
    "/((?!_next/static|_next/image|favicon.ico|b/|u/|api/webhooks/|api/health$|api/mcp$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|xml|woff2?)$).*)",
  ],
};
