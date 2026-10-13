import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(__dirname, "migration-drift.sh");

function drift(dir: string, remote: string) {
  try {
    const out = execFileSync("bash", [SCRIPT, dir], { input: remote, encoding: "utf8" });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { code: e.status, out: e.stdout };
  }
}

describe("migration-drift.sh", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "migrations-"));
  for (const name of ["0001_a.sql", "0002_b.sql", "0003_c.sql"]) {
    writeFileSync(path.join(dir, name), "select 1;");
  }
  writeFileSync(path.join(dir, "README.md"), "not a migration");
  mkdirSync(path.join(dir, "nested"));
  writeFileSync(path.join(dir, "nested", "0004_d.sql"), "select 1;");

  it("passes when production matches, in any order", () => {
    const res = drift(dir, "0003\n0001\n0002\n");
    expect(res.code).toBe(0);
    expect(res.out).toContain("exactly the repository's migrations");
  });

  it("names a version production is missing", () => {
    const res = drift(dir, "0001\n0002\n");
    expect(res.code).toBe(1);
    expect(res.out).toContain("Not applied to production: 0003");
    expect(res.out).not.toContain("Applied to production but not in the repository");
  });

  it("names a version only production has", () => {
    const res = drift(dir, "0001\n0002\n0003\n0009\n");
    expect(res.code).toBe(1);
    expect(res.out).toContain("Applied to production but not in the repository: 0009");
    expect(res.out).not.toContain("Not applied to production");
  });

  it("reports both directions at once", () => {
    const res = drift(dir, "0001\n0009\n");
    expect(res.code).toBe(1);
    expect(res.out).toContain("Not applied to production: 0002 0003");
    expect(res.out).toContain("Applied to production but not in the repository: 0009");
  });

  it("treats an empty production list as everything missing", () => {
    const res = drift(dir, "");
    expect(res.code).toBe(1);
    expect(res.out).toContain("Not applied to production: 0001 0002 0003");
  });
});
