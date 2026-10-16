import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { sendNotification } from "@/lib/email/resend";
import { createAdminAuthClient } from "@/lib/supabase/admin";
import { approveEmail } from "./actions";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/admin", () => ({ dbAdmin: { execute: vi.fn() } }));
vi.mock("@/lib/email/resend", () => ({ sendNotification: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminAuthClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const generateLink = vi.fn();

function form(email: string): FormData {
  const data = new FormData();
  data.set("email", email);
  return data;
}

describe("approveEmail", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://app.example");
    vi.mocked(requireAdmin).mockResolvedValue({ sub: "admin" });
    vi.mocked(dbAdmin.execute).mockResolvedValue([{ approved: true }] as never);
    vi.mocked(sendNotification).mockResolvedValue(true);
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hash123", verification_type: "signup" } },
      error: null,
    });
    vi.mocked(createAdminAuthClient).mockReturnValue({
      auth: { admin: { generateLink } },
    } as unknown as ReturnType<typeof createAdminAuthClient>);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("approves, sends the invitation and records it, leaving case to SQL and Auth", async () => {
    await expect(approveEmail({}, form("New@Example.test"))).resolves.toEqual({
      message: "Approved New@Example.test. Invitation sent.",
    });
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "New@Example.test" });
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "New@Example.test",
        subject: "You’re invited to Sealed",
        text: expect.stringContaining(
          "Sign in: https://app.example/auth/confirm?token_hash=hash123&type=signup",
        ),
      }),
    );
    expect(dbAdmin.execute).toHaveBeenCalledTimes(2);
  });

  it("reports a failed sign-in link like a failed email, sending nothing", async () => {
    generateLink.mockResolvedValue({
      data: { properties: null, user: null },
      error: { name: "AuthApiError", status: 500 },
    });
    await expect(approveEmail({}, form("new@example.test"))).resolves.toEqual({
      error:
        "Approved new@example.test, but the invitation email failed. Use Resend invitation to try again.",
    });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(dbAdmin.execute).toHaveBeenCalledTimes(1);
  });

  it("resends for an email that was already approved", async () => {
    vi.mocked(dbAdmin.execute).mockResolvedValueOnce([{ approved: false }] as never);
    await expect(approveEmail({}, form("old@example.test"))).resolves.toEqual({
      message: "old@example.test was already approved. Invitation sent.",
    });
  });

  it("keeps the approval but reports a failed invitation without recording it", async () => {
    vi.mocked(sendNotification).mockResolvedValue(false);
    await expect(approveEmail({}, form("new@example.test"))).resolves.toEqual({
      error:
        "Approved new@example.test, but the invitation email failed. Use Resend invitation to try again.",
    });
    expect(dbAdmin.execute).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the approval fails", async () => {
    vi.mocked(dbAdmin.execute).mockRejectedValueOnce(new Error("boom"));
    await expect(approveEmail({}, form("new@example.test"))).resolves.toEqual({
      error: "Could not approve that email.",
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("fails loudly without APP_URL and changes nothing", async () => {
    vi.stubEnv("APP_URL", "");
    await expect(approveEmail({}, form("new@example.test"))).rejects.toThrow(
      "Missing required environment variable: APP_URL",
    );
    expect(dbAdmin.execute).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("checks admin access before anything else", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NOT_FOUND"));
    await expect(approveEmail({}, form("new@example.test"))).rejects.toThrow("NOT_FOUND");
    expect(dbAdmin.execute).not.toHaveBeenCalled();
  });
});
