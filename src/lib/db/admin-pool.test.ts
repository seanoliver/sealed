import { describe, expect, it } from "vitest";
import { dbAdmin } from "./admin";

describe("dbAdmin pool", () => {
  it("closes idle connections after 5s", () => {
    expect(dbAdmin.$client.options.idleTimeoutMillis).toBe(5_000);
  });

  it("caps each instance at 5 connections", () => {
    expect(dbAdmin.$client.options.max).toBe(5);
  });
});
