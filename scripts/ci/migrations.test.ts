import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.join(__dirname, "../../supabase/migrations");
const EXEMPT = new Set(["00000000000001", "00000000000002", "00000000000003"]);

const MAX_LOCK_TIMEOUT_MS = 30_000;
const UNIT_MS: Record<string, number> = { "": 1, ms: 1, s: 1000, min: 60_000 };

function startsWithLockTimeout(sql: string): boolean {
  const body = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .trim();
  const match = /^set\s+lock_timeout\s*(?:=|to)\s*'?(\d+)\s*(ms|s|min)?'?\s*;/i.exec(body);
  if (!match) return false;
  const ms = Number(match[1]) * UNIT_MS[(match[2] ?? "").toLowerCase()];
  return ms > 0 && ms <= MAX_LOCK_TIMEOUT_MS;
}

describe("startsWithLockTimeout", () => {
  it.each([
    "set lock_timeout = '5s';\nalter table t add column c int;",
    "-- why\nSET lock_timeout TO '5s';",
    "/* header */\nset lock_timeout='5s';",
    "set lock_timeout = 5000;",
    "set lock_timeout = '30s';",
    "set lock_timeout = '500ms';",
  ])("accepts %j", (sql) => expect(startsWithLockTimeout(sql)).toBe(true));

  it.each([
    "alter table t add column c int;",
    "alter table t add column c int;\nset lock_timeout = '5s';",
    "set local lock_timeout = '5s';",
    "set lock_timeout = 0;",
    "set lock_timeout = '0s';",
    "set lock_timeout = '31s';",
    "set lock_timeout = '1min';",
    "set lock_timeout = '5h';",
  ])("rejects %j", (sql) => expect(startsWithLockTimeout(sql)).toBe(false));
});

describe("production migrations", () => {
  const files = readdirSync(DIR).filter(
    (f) => /^\d+_.*\.sql$/.test(f) && !EXEMPT.has(f.split("_")[0]),
  );

  it.each(files.length ? files : ["(none yet)"])("%s starts with a lock timeout", (file) => {
    if (file === "(none yet)") return;
    expect(startsWithLockTimeout(readFileSync(path.join(DIR, file), "utf8"))).toBe(true);
  });
});
