import { afterEach, describe, expect, it, vi } from "vitest";
import { contactReadings } from "./pinyin";

const { fail } = vi.hoisted(() => ({ fail: { times: 0 } }));
vi.mock("pinyin-pro", async (importOriginal) => {
  if (fail.times > 0) {
    fail.times -= 1;
    throw new Error("chunk failed to load");
  }
  return importOriginal();
});

const people = [{ full: "张伟", first: null, last: null }];

describe("loading pinyin-pro", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows names without pinyin when the import fails, then retries", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    fail.times = 1;
    expect(await contactReadings({ people })).toEqual({});
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("[py] [contactReadings] pinyin-pro failed to load"),
    );
    expect(await contactReadings({ people })).toEqual({ 张伟: ["Zhāng", "Wěi"] });
  });
});
