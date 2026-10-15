import { NextResponse, type NextRequest } from "next/server";
import { TOKEN_SHAPE } from "@/lib/tokens";
import {
  UPDATE_FORM_PATH,
  tokenRef,
  updateTokenCookieName,
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
  const valid = TOKEN_SHAPE.test(token);
  if (valid) target.searchParams.set("ref", tokenRef(token));

  const res = NextResponse.redirect(target, 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  if (valid) {
    res.cookies.set(
      updateTokenCookieName(tokenRef(token)),
      token,
      updateTokenCookieOptions({
        secure: request.nextUrl.protocol === "https:",
      }),
    );
  }
  return res;
}
