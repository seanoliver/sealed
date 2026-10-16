import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "@/lib/auth";
import { dbAdmin } from "@/lib/db/admin";
import { sendNotification } from "@/lib/email/resend";
import { approveEmail } from "./actions";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/admin", () => ({ dbAdmin: { execute: vi.fn() } }));
vi.mock("@/lib/email/resend", () => ({ sendNotification: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

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
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("approves, sends the invitation and records it", async () => {
    await expect(approveEmail({}, form("New@Example.test"))).resolves.toEqual({
      message: "Approved new@example.test. Invitation sent.",
    });
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ to: "new@example.test", subject: "You’re invited to Sealed" }),
    );
    expect(dbAdmin.execute).toHaveBeenCalledTimes(2);
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
