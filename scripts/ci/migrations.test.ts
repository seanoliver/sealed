import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.join(__dirname, "../../supabase/migrations");
const EXEMPT = new Set(["00000000000001", "00000000000002", "00000000000003"]);

const migrations = readdirSync(DIR).filter((f) => /^\d+_.*\.sql$/.test(f));
const checked = migrations.filter((f) => !EXEMPT.has(f.split("_")[0]));

describe("production migrations", () => {
  it.each(checked.length ? checked : ["(none yet)"])(
    "%s sets a lock timeout before any other statement",
    (file) => {
      if (file === "(none yet)") return;
      const sql = readFileSync(path.join(DIR, file), "utf8")
        .replace(/--.*$/gm, "")
        .trim();
      expect(sql).toMatch(/^set\s+local\s+lock_timeout\s*=/i);
    },
  );
});
