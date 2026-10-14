import { NextResponse, type NextRequest } from "next/server";
import { TOKEN_SHAPE } from "@/lib/tokens";
import {
  UPDATE_FORM_PATH,
  UPDATE_TOKEN_COOKIE,
  updateTokenCookieOptions,
} from "../update-token-cookie";

// No DB work here: the form page does the rate-limited token lookup.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const target = request.nextUrl.clone();
  target.pathname = UPDATE_FORM_PATH;
  target.search = "";
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
    // Otherwise a token from an earlier link would open that contact instead.
    res.cookies.set(UPDATE_TOKEN_COOKIE, "", { path: "/u", maxAge: 0 });
  }
  return res;
}
