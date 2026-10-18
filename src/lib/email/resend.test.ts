import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

import { sendNotification } from "./resend";

const item = { to: "a@example.test", subject: "Hi", html: "<p>Hi</p>", text: "Hi" };

describe("sendNotification", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("EMAIL_DRY_RUN", "");
    vi.stubEnv("EMAIL_FROM", "Sealed <hello@example.test>");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    send.mockResolvedValue({ data: { id: "id1" }, error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    send.mockReset();
  });

  it("returns true when Resend accepts the email", async () => {
    await expect(sendNotification(item)).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Sealed <hello@example.test>", to: item.to }),
    );
  });

  it("returns false without EMAIL_FROM, sending nothing", async () => {
    vi.stubEnv("EMAIL_FROM", "");
    await expect(sendNotification(item)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns false when Resend reports an error", async () => {
    send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "bad" } });
    await expect(sendNotification(item)).resolves.toBe(false);
  });

  it("returns false when the client throws", async () => {
    send.mockRejectedValue(new Error("network"));
    await expect(sendNotification(item)).resolves.toBe(false);
  });

  it("returns true in dry-run without sending", async () => {
    vi.stubEnv("EMAIL_DRY_RUN", "1");
    await expect(sendNotification(item)).resolves.toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});
