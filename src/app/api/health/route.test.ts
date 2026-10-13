import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pingDatabase } from "@/lib/db/health";
import { sendNotification } from "@/lib/email/resend";
import { GET } from "./route";

vi.mock("@/lib/db/health", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/health")>();
  return { pingDatabase: vi.fn(actual.pingDatabase) };
});

vi.mock("@/lib/email/resend", () => ({
  sendNotification: vi.fn(async () => {}),
}));

const SECRET = "health-route-test-secret-0123456789";
const URL_ = "http://localhost:3000/api/health";

function get(headers: Record<string, string> = {}): Promise<Response> {
  return GET(new Request(URL_, { headers }));
}

const authorized = { authorization: `Bearer ${SECRET}` };

function leakyDbError(): Error {
  const err = Object.assign(
    new Error(
      'connect ECONNREFUSED db.internal:5432 (password authentication failed for user "app_hunter2")',
    ),
    { code: "ECONNREFUSED" },
  );
  return new Error("Failed query: select 1", { cause: err });
}

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("HEALTH_ALERT_EMAIL", "ops@test.dev");
    vi.stubEnv("APP_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.mocked(pingDatabase).mockClear();
    vi.mocked(sendNotification).mockClear();
  });

  it("rejects a request without an Authorization header with 401", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false });
    expect(pingDatabase).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret with 401", async () => {
    for (const authorization of [
      "Bearer wrong-secret",
      SECRET,
      `Bearer ${SECRET}x`,
      "Bearer ",
    ]) {
      const res = await get({ authorization });
      expect(res.status).toBe(401);
    }
    expect(pingDatabase).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // Even "Bearer " (the empty-secret header) must not authenticate.
    const res = await get({ authorization: "Bearer " });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
    expect(error).toHaveBeenCalledOnce();
    expect(pingDatabase).not.toHaveBeenCalled();
  });

  it("returns 200 { ok: true } when the database query succeeds", async () => {
    const res = await get(authorized);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(pingDatabase).toHaveBeenCalledOnce();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("returns 503 { ok: false } with no error details when the query fails", async () => {
    vi.mocked(pingDatabase).mockRejectedValueOnce(leakyDbError());
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(authorized);
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ok: false });

    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("[hc] [health]");
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).not.toContain("connect ECONNREFUSED");
    expect(`${body} ${logged}`).not.toContain("hunter2");
    expect(`${body} ${logged}`).not.toContain("db.internal");
  });

  it("attempts an alert email on failure without error details", async () => {
    vi.mocked(pingDatabase).mockRejectedValueOnce(leakyDbError());
    vi.spyOn(console, "error").mockImplementation(() => {});

    await get(authorized);

    expect(sendNotification).toHaveBeenCalledOnce();
    const item = vi.mocked(sendNotification).mock.calls[0][0];
    expect(item.to).toBe("ops@test.dev");
    expect(item.subject).toContain("Database health check failed");
    expect(item.subject).toContain("(production)");
    expect(`${item.subject}${item.html}${item.text}`).not.toContain("hunter2");
  });

  it("skips the alert silently when HEALTH_ALERT_EMAIL is unset", async () => {
    vi.stubEnv("HEALTH_ALERT_EMAIL", "");
    vi.mocked(pingDatabase).mockRejectedValueOnce(leakyDbError());
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(authorized);
    expect(res.status).toBe(503);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("still returns 503 when the alert itself fails", async () => {
    vi.mocked(pingDatabase).mockRejectedValueOnce(leakyDbError());
    vi.mocked(sendNotification).mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(authorized);
    expect(res.status).toBe(503);
  });

  it("returns 503 and alerts when the database never answers", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(pingDatabase).mockReturnValueOnce(new Promise<void>(() => {}));
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      let settled = false;
      const pending = get(authorized).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(settled).toBe(false);
      expect(sendNotification).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;

      expect(res.status).toBe(503);
      expect(sendNotification).toHaveBeenCalledOnce();
      expect(error.mock.calls.flat().join(" ")).toContain("TIMEOUT");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the alert to finish before responding", async () => {
    vi.mocked(pingDatabase).mockRejectedValueOnce(leakyDbError());
    vi.spyOn(console, "error").mockImplementation(() => {});
    let finishAlert!: () => void;
    vi.mocked(sendNotification).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishAlert = resolve;
      }),
    );

    let settled = false;
    const pending = get(authorized).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    finishAlert();
    expect((await pending).status).toBe(503);
  });
});
