import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.join(__dirname, "../../supabase/migrations");
const EXEMPT = new Set(["00000000000001", "00000000000002", "00000000000003"]);

function startsWithLockTimeout(sql: string): boolean {
  const body = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .trim();
  return /^set\s+lock_timeout\s*(=|to)/i.test(body);
}

describe("startsWithLockTimeout", () => {
  it.each([
    "set lock_timeout = '5s';\nalter table t add column c int;",
    "-- why\nSET lock_timeout TO '5s';",
    "/* header */\nset lock_timeout='5s';",
  ])("accepts %j", (sql) => expect(startsWithLockTimeout(sql)).toBe(true));

  it.each([
    "alter table t add column c int;",
    "alter table t add column c int;\nset lock_timeout = '5s';",
    "set local lock_timeout = '5s';",
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
