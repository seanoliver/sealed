import { NextResponse, type NextRequest } from "next/server";
import { TOKEN_SHAPE } from "@/lib/tokens";
import {
  UPDATE_FORM_PATH,
  UPDATE_TOKEN_COOKIE,
  updateTokenCookieOptions,
} from "../update-token-cookie";

/**
 * Entry point for the emailed /u/<token> link. Request logs record the path,
 * so the token moves into an HttpOnly cookie and the browser is sent to a
 * token-free URL. No DB work here: the form page does the rate-limited
 * lookup, and dead tokens render the same generic page there.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const target = request.nextUrl.clone();
  target.pathname = UPDATE_FORM_PATH;
  target.search = "";
  // 303: the follow-up is always a plain GET of the form page.
  const res = NextResponse.redirect(target, 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");

  if (TOKEN_SHAPE.test(token)) {
    res.cookies.set(
      UPDATE_TOKEN_COOKIE,
      token,
      updateTokenCookieOptions({
        secure: request.nextUrl.protocol === "https:",
      }),
    );
  } else {
    // A malformed link must not fall through to a token held from an
    // earlier link: clear it so the form page shows the invalid notice.
    res.cookies.set(UPDATE_TOKEN_COOKIE, "", { path: "/u", maxAge: 0 });
  }
  return res;
}
