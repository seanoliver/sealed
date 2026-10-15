import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { generateToken } from "@/lib/tokens";
import {
  readUpdateToken,
  tokenRef,
  updateTokenCookieName,
} from "../update-token-cookie";
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
  it("moves a well-formed token into a per-link HttpOnly cookie and redirects to a token-free URL", async () => {
    const { token } = generateToken();
    const ref = tokenRef(token);
    const res = await visit(token);

    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/u/edit");
    expect(location.searchParams.get("ref")).toBe(ref);
    expect(location.href).not.toContain(token);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${updateTokenCookieName(ref)}=${token}`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/u(;|$)/);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/Max-Age=86400(;|$)/);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("drops any query string from the emailed link", async () => {
    const { token } = generateToken();
    const res = await GET(
      new NextRequest(`https://sealed.page/u/${token}?utm_source=mail`),
      { params: Promise.resolve({ token }) },
    );
    const location = new URL(res.headers.get("location") ?? "");
    expect([...location.searchParams.keys()]).toEqual(["ref"]);
  });

  it("omits Secure over plain http so local dev can hold the cookie", async () => {
    const { token } = generateToken();
    const res = await visit(token, "http://localhost:3000");
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/Secure/i);
  });

  it("sends a malformed link to the form page with no ref and sets no cookie", async () => {
    const res = await visit("not-a-real-token");

    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/u/edit");
    expect(location.search).toBe("");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("readUpdateToken", () => {
  const jar = (entries: Record<string, string>) => ({
    get: (name: string) =>
      name in entries ? { value: entries[name] } : undefined,
  });

  it("returns the token held for its own ref", () => {
    const { token } = generateToken();
    const ref = tokenRef(token);
    expect(readUpdateToken(jar({ [updateTokenCookieName(ref)]: token }), ref)).toBe(token);
  });

  it("ignores another link's cookie", () => {
    const a = generateToken().token;
    const b = generateToken().token;
    const refA = tokenRef(a);
    expect(
      readUpdateToken(jar({ [updateTokenCookieName(tokenRef(b))]: b }), refA),
    ).toBeNull();
  });

  it("rejects a cookie whose token does not hash to the ref", () => {
    const a = generateToken().token;
    const b = generateToken().token;
    const refA = tokenRef(a);
    expect(readUpdateToken(jar({ [updateTokenCookieName(refA)]: b }), refA)).toBeNull();
  });

  it("rejects a malformed ref", () => {
    expect(readUpdateToken(jar({}), "../x")).toBeNull();
  });
});
