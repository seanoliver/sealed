import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function mockFetchJson(body: unknown, ok = true) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("verifyTurnstile", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns true when siteverify reports success", async () => {
    const fetchMock = mockFetchJson({ success: true });
    await expect(verifyTurnstile("resp-token")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    const params = init.body as URLSearchParams;
    expect(params.get("secret")).toBe("test-secret");
    expect(params.get("response")).toBe("resp-token");
    expect(params.get("remoteip")).toBeNull();
  });

  it("includes remoteip when a real IP is provided", async () => {
    const fetchMock = mockFetchJson({ success: true });
    await verifyTurnstile("resp-token", "203.0.113.7");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as URLSearchParams).get("remoteip")).toBe("203.0.113.7");
  });

  it('omits remoteip for the "unknown" fallback', async () => {
    const fetchMock = mockFetchJson({ success: true });
    await verifyTurnstile("resp-token", "unknown");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as URLSearchParams).get("remoteip")).toBeNull();
  });

  it("returns false when siteverify reports failure", async () => {
    mockFetchJson({ success: false, "error-codes": ["invalid-input-response"] });
    await expect(verifyTurnstile("resp-token")).resolves.toBe(false);
  });

  it("fails closed on a non-2xx response", async () => {
    mockFetchJson({ success: true }, false);
    await expect(verifyTurnstile("resp-token")).resolves.toBe(false);
  });

  it("fails closed on a malformed body", async () => {
    mockFetchJson("not-an-object");
    await expect(verifyTurnstile("resp-token")).resolves.toBe(false);
    mockFetchJson(null);
    await expect(verifyTurnstile("resp-token")).resolves.toBe(false);
    // success must be boolean true, not merely truthy
    mockFetchJson({ success: "true" });
    await expect(verifyTurnstile("resp-token")).resolves.toBe(false);
  });

  it("fails closed when fetch throws (network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await expect(verifyTurnstile("resp-token")).resolves.toBe(false);
  });

  it("gives siteverify a 5-second timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const fetchMock = mockFetchJson({ success: true });
      await verifyTurnstile("resp-token");
      expect(timeout).toHaveBeenCalledWith(5000);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBe(timeout.mock.results[0].value);
    } finally {
      timeout.mockRestore();
    }
  });

  it("fails closed on an empty response token without calling out", async () => {
    const fetchMock = mockFetchJson({ success: true });
    await expect(verifyTurnstile("")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on an oversized response token without calling out", async () => {
    const fetchMock = mockFetchJson({ success: true });
    await expect(verifyTurnstile("x".repeat(2049))).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is not configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const fetchMock = mockFetchJson({ success: true });
    await expect(verifyTurnstile("resp-token")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
