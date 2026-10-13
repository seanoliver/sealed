import { afterEach, describe, expect, it, vi } from "vitest";
import { logDbError } from "./log";

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint "books_slug_key"'), {
    code: "23505",
    constraint_name: "books_slug_key",
  });
}

describe("logDbError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes the Postgres message by default", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logDbError("[t]", uniqueViolation());
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("23505");
    expect(logged).toContain("duplicate key value");
  });

  it("omits the message when includeMessage is false", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logDbError("[t]", uniqueViolation(), { includeMessage: false });
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("23505");
    expect(logged).not.toContain("duplicate key value");
  });
});
