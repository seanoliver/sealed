import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS = path.resolve(__dirname);
const CHECKS = ["Lint & typecheck", "Build"];
const ACTIONS = { id: 15368 };

function run(script: string, args: string[], input: string) {
  try {
    const stdout = execFileSync("bash", [path.join(SCRIPTS, script), ...args], {
      input,
      encoding: "utf8",
    });
    return { code: 0, out: stdout };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { code: e.status, out: e.stdout };
  }
}

function checkRun(
  name: string,
  conclusion: string | null,
  completedAt: string | null,
  app = ACTIONS,
) {
  return {
    name,
    app,
    status: completedAt ? "completed" : "in_progress",
    conclusion,
    completed_at: completedAt,
  };
}

function gate(runs: unknown[]) {
  return run("check-runs-gate.sh", CHECKS, JSON.stringify({ check_runs: runs }));
}

describe("check-runs-gate.sh", () => {
  const t1 = "2026-10-13T10:00:00Z";
  const t2 = "2026-10-13T11:00:00Z";

  it("passes when every check's latest run succeeded", () => {
    const res = gate([
      checkRun("Lint & typecheck", "success", t1),
      checkRun("Build", "failure", t1),
      checkRun("Build", "success", t2),
    ]);
    expect(res.code).toBe(0);
  });

  it("fails when the latest run failed after an earlier success", () => {
    const res = gate([
      checkRun("Lint & typecheck", "success", t1),
      checkRun("Build", "success", t1),
      checkRun("Build", "failure", t2),
    ]);
    expect(res.code).toBe(1);
    expect(res.out).toContain("'Build' is 'failure'");
  });

  it("fails when a check is missing", () => {
    const res = gate([checkRun("Lint & typecheck", "success", t1)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain("'Build' is 'missing'");
  });

  it("fails while any run of a check is still in progress", () => {
    const res = gate([
      checkRun("Lint & typecheck", "success", t1),
      checkRun("Build", "success", t1),
      checkRun("Build", null, null),
    ]);
    expect(res.code).toBe(1);
    expect(res.out).toContain("'Build' is 'in progress'");
  });

  it("ignores same-named checks from apps other than GitHub Actions", () => {
    const res = gate([
      checkRun("Lint & typecheck", "success", t1),
      checkRun("Build", "success", t1, { id: 999 }),
    ]);
    expect(res.code).toBe(1);
    expect(res.out).toContain("'Build' is 'missing'");
  });

  it.each(["skipped", "cancelled", "neutral"])("fails on %s", (conclusion) => {
    const res = gate([
      checkRun("Lint & typecheck", "success", t1),
      checkRun("Build", conclusion, t1),
    ]);
    expect(res.code).toBe(1);
  });
});

describe("migration-drift.sh", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "migrations-"));
  for (const name of ["0001_a.sql", "0002_b.sql", "0003_c.sql"]) {
    writeFileSync(path.join(dir, name), "select 1;");
  }
  writeFileSync(path.join(dir, "README.md"), "not a migration");

  const drift = (remote: string) => run("migration-drift.sh", [dir], remote);

  it("passes when production matches, in any order", () => {
    const res = drift("0003\n0001\n0002\n");
    expect(res.code).toBe(0);
    expect(res.out).toContain("exactly the migrations");
  });

  it("names a version production is missing", () => {
    const res = drift("0001\n0002\n");
    expect(res.code).toBe(1);
    expect(res.out).toContain("Not applied to production (run Migrate production): 0003");
    expect(res.out).not.toContain("Applied to production but not on main");
  });

  it("names a version only production has", () => {
    const res = drift("0001\n0002\n0003\n0009\n");
    expect(res.code).toBe(1);
    expect(res.out).toContain("Applied to production but not on main");
    expect(res.out).toContain("0009");
    expect(res.out).not.toContain("Not applied to production");
  });

  it("reports both directions at once", () => {
    const res = drift("0001\n0009\n");
    expect(res.code).toBe(1);
    expect(res.out).toContain("Not applied to production (run Migrate production): 0002 0003");
    expect(res.out).toContain("0009");
  });

  it("treats an empty production list as everything missing", () => {
    const res = drift("");
    expect(res.code).toBe(1);
    expect(res.out).toContain("0001 0002 0003");
  });
});
