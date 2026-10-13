import { afterEach, describe, expect, it, vi } from "vitest";
import { dbAdmin } from "./admin";
import { pingDatabase } from "./health";

describe("pingDatabase", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs one query against the database", async () => {
    const execute = vi.spyOn(dbAdmin, "execute");
    await pingDatabase();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects when the query fails", async () => {
    vi.spyOn(dbAdmin, "execute").mockRejectedValueOnce(new Error("down"));
    await expect(pingDatabase()).rejects.toThrow("down");
  });
});
