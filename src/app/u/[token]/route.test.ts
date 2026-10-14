import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { generateToken } from "@/lib/tokens";
import { UPDATE_TOKEN_COOKIE } from "../update-token-cookie";
import { GET } from "./route";

function visit(
  token: string,
  origin = "https://sealed.page",
): Promise<Response> {
  return GET(new NextRequest(`${origin}/u/${token}`), {
    params: Promise.resolve({ token }),
  });
}

describe("GET /u/[token]", () => {
  it("moves a well-formed token into an HttpOnly cookie and redirects to a token-free URL", async () => {
    const { token } = generateToken();
    const res = await visit(token);

    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(new URL(location).pathname).toBe("/u/edit");
    expect(location).not.toContain(token);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${UPDATE_TOKEN_COOKIE}=${token}`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/u(;|$)/);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/Max-Age=\d+/);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("omits Secure over plain http so local dev can hold the cookie", async () => {
    const { token } = generateToken();
    const res = await visit(token, "http://localhost:3000");
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/Secure/i);
  });

  it("clears any held token when the path is malformed, still redirecting", async () => {
    const res = await visit("not-a-real-token");

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe(
      "/u/edit",
    );
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${UPDATE_TOKEN_COOKIE}=;`);
    expect(setCookie).not.toContain("not-a-real-token");
  });
});
