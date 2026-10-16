import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { WAITLIST_REJECTION } from "@/lib/waitlist";
import { requestAccess, type RequestAccessState } from "./actions";

vi.mock("@/lib/db/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({
  requestIp: vi.fn(async () => "203.0.113.7"),
  hashedIpKey: (prefix: string, value: string) => `${prefix}:${value}`,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const signInWithOtp = vi.fn();
const idle: RequestAccessState = { status: "idle" };

function form(email: string): FormData {
  const data = new FormData();
  data.set("email", email);
  data.set("cf-turnstile-response", "token");
  return data;
}

describe("requestAccess", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://app.example");
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(verifyTurnstile).mockResolvedValue(true);
    signInWithOtp.mockResolvedValue({ error: null });
    vi.mocked(createClient).mockResolvedValue({
      auth: { signInWithOtp },
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("sends a magic link to a valid email", async () => {
    await expect(requestAccess(idle, form(" a@example.test "))).resolves.toEqual({
      status: "sent",
      email: "a@example.test",
    });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "a@example.test",
      options: { emailRedirectTo: "https://app.example/auth/confirm?flow=login" },
    });
  });

  it.each([
    ["waitlisted", { message: WAITLIST_REJECTION, status: 403 }],
    ["rate-limited by Supabase", { message: "email rate limit exceeded", status: 429 }],
  ])("reports %s emails as sent", async (_label, error) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    signInWithOtp.mockResolvedValue({ error: { name: "AuthApiError", ...error } });
    await expect(requestAccess(idle, form("a@example.test"))).resolves.toEqual({
      status: "sent",
      email: "a@example.test",
    });
  });

  it("logs any other Supabase failure and still reports the email as sent", async () => {
    signInWithOtp.mockResolvedValue({
      error: { name: "AuthApiError", message: "Database error", status: 500 },
    });
    await expect(requestAccess(idle, form("a@example.test"))).resolves.toEqual({
      status: "sent",
      email: "a@example.test",
    });
    expect(console.error).toHaveBeenCalledWith(
      "[ra] [requestAccess] signInWithOtp failed: AuthApiError 500",
    );
  });

  it("rejects an invalid email before any other check", async () => {
    await expect(requestAccess(idle, form("not-an-email"))).resolves.toEqual({
      status: "error",
      message: "Enter a valid email address.",
    });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("limits per email after Turnstile", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(requestAccess(idle, form("a@example.test"))).resolves.toEqual({
      status: "error",
      message: "Too many requests. Please try again later.",
    });
    expect(checkRateLimit).toHaveBeenNthCalledWith(1, "request-access:203.0.113.7", 5, 3600);
    expect(checkRateLimit).toHaveBeenNthCalledWith(2, "request-access-email:a@example.test", 3, 3600);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("stops at the client limit without checking Turnstile or the email limit", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    await expect(requestAccess(idle, form("a@example.test"))).resolves.toMatchObject({
      status: "error",
    });
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(verifyTurnstile).not.toHaveBeenCalled();
  });

  it("fails closed when the limiter is unavailable", async () => {
    vi.mocked(checkRateLimit).mockRejectedValue(new Error("connection refused"));
    await expect(requestAccess(idle, form("a@example.test"))).resolves.toMatchObject({
      status: "error",
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("requires a Turnstile pass before touching the email's limit", async () => {
    vi.mocked(verifyTurnstile).mockResolvedValue(false);
    await expect(requestAccess(idle, form("a@example.test"))).resolves.toEqual({
      status: "error",
      message: "Verification failed. Please try again.",
    });
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});
