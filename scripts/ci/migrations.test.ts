import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.join(__dirname, "../../supabase/migrations");
const EXEMPT = new Set(["00000000000001", "00000000000002", "00000000000003"]);

const MAX_LOCK_TIMEOUT_MS = 30_000;
const UNIT_MS: Record<string, number> = { "": 1, ms: 1, s: 1000, min: 60_000 };

// Postgres unit names are case-sensitive, so only the keywords match case-insensitively.
function startsWithLockTimeout(sql: string): boolean {
  const body = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .trim();
  const keyword = /^set\s+lock_timeout\s*(?:=|to)\s*/i.exec(body);
  if (!keyword) return false;
  const rest = body.slice(keyword[0].length);
  const value = /^(?:(\d+)|'(\d+)\s*(ms|s|min)?')\s*;/.exec(rest);
  const later = rest.replace(/\breset\s+lock_timeout\s*;\s*$/i, "");
  if (!value || /\block_timeout\b|\breset\s+all\b/i.test(later)) return false;
  const ms = Number(value[1] ?? value[2]) * UNIT_MS[value[3] ?? ""];
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
    "set lock_timeout = '5000';",
    "set lock_timeout = '5 s';",
    "set lock_timeout = '5s';\nalter table t add column c int;\nreset lock_timeout;",
    "set lock_timeout = '5s';\nalter table t add column lock_timeout_note text;",
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
    "set lock_timeout = '5S';",
    "set lock_timeout = 5s;",
    "set lock_timeout = '5s;",
    "set lock_timeout = 5s';",
    "set lock_timeout = '5s';\nset lock_timeout = 0;",
    "set lock_timeout = '5s';\nreset lock_timeout;\nalter table t add column c int;",
    "set lock_timeout = '5s';\nset local lock_timeout = 0;",
    "set lock_timeout = '5s';\nset session lock_timeout = 0;",
    "set lock_timeout = '5s';\nselect set_config('lock_timeout', '0', false);",
    "set lock_timeout = '5s';\nreset all;\nalter table t add column c int;",
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
