import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
const batchSend = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
    batch = { send: batchSend };
  },
}));

import { sendAddressRequests, sendNotification } from "./resend";

const item = {
  to: "a@example.test",
  subject: "Hi",
  html: "<p>Hi</p>",
  text: "Hi",
};

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
      expect.objectContaining({
        from: "Sealed <hello@example.test>",
        to: item.to,
      }),
    );
  });

  it("returns false without EMAIL_FROM, sending nothing", async () => {
    vi.stubEnv("EMAIL_FROM", "");
    await expect(sendNotification(item)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns false when Resend reports an error", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "bad" },
    });
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

describe("sendAddressRequests", () => {
  const items = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...item,
      to: `r${i}@example.test`,
    }));
  const ok = (
    ids: string[],
    errors?: { index: number; message: string }[],
  ) => ({
    data: { data: ids.map((id) => ({ id })), ...(errors ? { errors } : {}) },
    error: null,
  });
  const fail = (name: string, statusCode: number | null) => ({
    data: null,
    error: { name, message: "x", statusCode },
  });
  const opts = { batchKey: "k1", retryDelaysMs: [0, 0, 0] };

  beforeEach(() => {
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("EMAIL_DRY_RUN", "");
    vi.stubEnv("EMAIL_FROM", "Sealed <hello@example.test>");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    batchSend.mockReset();
  });

  it("sends permissively with a per-chunk idempotency key, 100 per call", async () => {
    batchSend.mockImplementation(async (payload: unknown[]) =>
      ok(payload.map((_, i) => `id${i}`)),
    );
    const results = await sendAddressRequests(items(150), opts);
    expect(batchSend).toHaveBeenCalledTimes(2);
    expect(batchSend.mock.calls[0][0]).toHaveLength(100);
    expect(batchSend.mock.calls[1][0]).toHaveLength(50);
    expect(batchSend.mock.calls[0][1]).toEqual({
      batchValidation: "permissive",
      idempotencyKey: "k1/0",
    });
    expect(batchSend.mock.calls[1][1]).toEqual({
      batchValidation: "permissive",
      idempotencyKey: "k1/1",
    });
    expect(results.every((r) => r.status === "sent")).toBe(true);
    expect(results[149]).toEqual({
      status: "sent",
      id: "id49",
      to: "r149@example.test",
    });
  });

  it("says why an email failed", async () => {
    batchSend.mockResolvedValueOnce(ok(["a"], [{ index: 1, message: "bad" }]));
    expect((await sendAddressRequests(items(2), opts))[1]).toMatchObject({
      status: "failed",
      reason: "rejected",
    });
    batchSend.mockResolvedValueOnce(fail("daily_quota_exceeded", 429));
    expect((await sendAddressRequests(items(1), opts))[0]).toMatchObject({
      status: "failed",
      reason: "quota",
    });
    batchSend.mockResolvedValueOnce(fail("validation_error", 422));
    expect((await sendAddressRequests(items(1), opts))[0]).toMatchObject({
      status: "failed",
      reason: "error",
    });
  });

  it("fails only the rejected emails and keeps the other ids in place", async () => {
    batchSend.mockResolvedValue(
      ok(["a", "c"], [{ index: 1, message: "Invalid `to` field" }]),
    );
    const results = await sendAddressRequests(items(3), opts);
    expect(results.map((r) => [r.status, r.id])).toEqual([
      ["sent", "a"],
      ["failed", null],
      ["sent", "c"],
    ]);
  });

  it("marks accepted emails unknown when the id count does not line up", async () => {
    batchSend.mockResolvedValue(ok(["a"], [{ index: 2, message: "bad" }]));
    const results = await sendAddressRequests(items(3), opts);
    expect(results.map((r) => r.status)).toEqual([
      "unknown",
      "unknown",
      "failed",
    ]);
  });

  it("retries network errors, rate limits and key conflicts with the same key", async () => {
    batchSend
      .mockResolvedValueOnce(fail("application_error", null))
      .mockResolvedValueOnce(fail("rate_limit_exceeded", 429))
      .mockResolvedValueOnce(fail("concurrent_idempotent_requests", 409))
      .mockResolvedValueOnce(ok(["a"]));
    const results = await sendAddressRequests(items(1), opts);
    expect(batchSend).toHaveBeenCalledTimes(4);
    expect(
      new Set(batchSend.mock.calls.map((c) => c[1].idempotencyKey)),
    ).toEqual(new Set(["k1/0"]));
    expect(results[0].status).toBe("sent");
  });

  it("reports unknown once retries run out, since Resend may have sent", async () => {
    batchSend.mockResolvedValue(fail("internal_server_error", 500));
    const results = await sendAddressRequests(items(2), opts);
    expect(batchSend).toHaveBeenCalledTimes(4);
    expect(results.map((r) => r.status)).toEqual(["unknown", "unknown"]);
  });

  it("reports unknown when a permanent error follows an ambiguous attempt", async () => {
    batchSend
      .mockResolvedValueOnce(fail("application_error", null))
      .mockResolvedValueOnce(fail("daily_quota_exceeded", 429));
    const results = await sendAddressRequests(items(2), opts);
    expect(results.map((r) => r.status)).toEqual(["unknown", "unknown"]);
  });

  it("reports failed when every attempt was rate limited", async () => {
    batchSend.mockResolvedValue(fail("rate_limit_exceeded", 429));
    const results = await sendAddressRequests(items(1), opts);
    expect(results[0].status).toBe("failed");
  });

  it("treats a missing status code as ambiguous", async () => {
    batchSend
      .mockResolvedValueOnce({
        data: null,
        error: { name: "application_error", message: "x" },
      })
      .mockResolvedValueOnce(ok(["a"]));
    const results = await sendAddressRequests(items(1), opts);
    expect(results[0].status).toBe("sent");
  });

  it("times out a hung call and retries it with the same key", async () => {
    batchSend
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce(ok(["a"]));
    const results = await sendAddressRequests(items(1), {
      ...opts,
      attemptTimeoutMs: 5,
    });
    expect(batchSend).toHaveBeenCalledTimes(2);
    expect(batchSend.mock.calls[1][1].idempotencyKey).toBe("k1/0");
    expect(results[0].status).toBe("sent");
  });

  it("stops at the time budget, failing chunks it never sent", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    batchSend.mockImplementation(async (payload: unknown[]) => {
      now += 100;
      return ok(payload.map((_, i) => `id${i}`));
    });
    const results = await sendAddressRequests(items(150), {
      ...opts,
      budgetMs: 50,
    });
    expect(batchSend).toHaveBeenCalledTimes(1);
    expect(results[0].status).toBe("sent");
    expect(results[100]).toMatchObject({ status: "failed", reason: "error" });
  });

  it("ignores a rejected index outside the chunk", async () => {
    batchSend.mockResolvedValue(ok(["a"], [{ index: 9, message: "x" }]));
    const results = await sendAddressRequests(items(1), opts);
    expect(results).toEqual([
      { status: "sent", id: "a", to: "r0@example.test" },
    ]);
  });

  it("times out each call after 20s and gives up within 240s by default", async () => {
    vi.useFakeTimers();
    try {
      batchSend.mockReturnValue(new Promise(() => {}));
      let settled = false;
      const done = sendAddressRequests(items(1), { batchKey: "k1" }).then(
        (r) => {
          settled = true;
          return r;
        },
      );
      await vi.advanceTimersByTimeAsync(19_999);
      expect(batchSend).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1 + 1000);
      expect(batchSend).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(80_000);
      expect(settled).toBe(true);
      expect((await done)[0].status).toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the third chunk's fourth call at the 240s default budget (each chunk takes 87s)", async () => {
    vi.useFakeTimers();
    try {
      batchSend.mockReturnValue(new Promise(() => {}));
      const done = sendAddressRequests(items(300), { batchKey: "k1" });
      await vi.advanceTimersByTimeAsync(300_000);
      const results = await done;
      expect(batchSend).toHaveBeenCalledTimes(11);
      expect(results.map((r) => r.status)).toEqual(Array(300).fill("unknown"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("cuts the last call short at the budget", async () => {
    vi.useFakeTimers();
    try {
      batchSend.mockReturnValue(new Promise(() => {}));
      let settled = false;
      void sendAddressRequests(items(1), {
        ...opts,
        attemptTimeoutMs: 60_000,
        budgetMs: 30_000,
      }).then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(30_001);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a thrown client error as retryable", async () => {
    batchSend
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok(["a"]));
    const results = await sendAddressRequests(items(1), opts);
    expect(results[0].status).toBe("sent");
  });

  it.each([
    ["daily_quota_exceeded", 429],
    ["monthly_quota_exceeded", 429],
    ["validation_error", 422],
  ])("fails the chunk on %s without retrying", async (name, statusCode) => {
    batchSend.mockResolvedValue(fail(name, statusCode));
    const results = await sendAddressRequests(items(2), opts);
    expect(batchSend).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status)).toEqual(["failed", "failed"]);
  });

  it("keeps sending later chunks after one fails", async () => {
    batchSend
      .mockResolvedValueOnce(fail("validation_error", 422))
      .mockImplementationOnce(async (payload: unknown[]) =>
        ok(payload.map((_, i) => `b${i}`)),
      );
    const results = await sendAddressRequests(items(101), opts);
    expect(results[0].status).toBe("failed");
    expect(results[100]).toEqual({
      status: "sent",
      id: "b0",
      to: "r100@example.test",
    });
  });

  it("refuses to send without EMAIL_FROM", async () => {
    vi.stubEnv("EMAIL_FROM", "");
    await expect(sendAddressRequests(items(1), opts)).rejects.toThrow(
      "EMAIL_FROM is not set",
    );
    expect(batchSend).not.toHaveBeenCalled();
  });

  it("rejects reserved .invalid addresses in dry-run", async () => {
    vi.stubEnv("EMAIL_DRY_RUN", "1");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const results = await sendAddressRequests(
      [{ ...item, to: "ivy@bad.invalid" }],
      opts,
    );
    expect(results).toEqual([
      { status: "failed", id: null, to: "ivy@bad.invalid", reason: "rejected" },
    ]);
  });

  it("returns sent dry-run ids without calling Resend", async () => {
    vi.stubEnv("EMAIL_DRY_RUN", "1");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const results = await sendAddressRequests(items(2), opts);
    expect(batchSend).not.toHaveBeenCalled();
    expect(
      results.every((r) => r.status === "sent" && r.id.startsWith("dry_")),
    ).toBe(true);
  });
});
