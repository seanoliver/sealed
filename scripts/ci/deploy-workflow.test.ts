import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.join(__dirname, "../../.github/workflows/deploy-production.yml"),
  "utf8",
);

describe("deploy-production.yml", () => {
  it("runs after CI on main and by hand", () => {
    expect(workflow).toMatch(/workflow_run:\n\s+workflows: \[CI\]\n\s+types: \[completed\]\n\s+branches: \[main\]/);
    expect(workflow).toMatch(/^\s+workflow_dispatch:$/m);
  });

  it("deploys only after a successful CI run for a push", () => {
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
  });

  it("uses the Production environment and checks out main", () => {
    expect(workflow).toMatch(/environment:\n\s+name: Production/);
    expect(workflow).toMatch(/uses: actions\/checkout@[0-9a-f]{40}.*\n\s+with:\n\s+ref: main/);
  });

  it("migrates, then checks drift on production's list, then deploys", () => {
    const push = workflow.indexOf("supabase db push");
    const versions = workflow.indexOf('psql "$url" -Atc "select version from supabase_migrations.schema_migrations"');
    const drift = workflow.indexOf('scripts/ci/migration-drift.sh supabase/migrations <<<"$versions"');
    const deploy = workflow.indexOf("vercel deploy --prod");
    expect(push).toBeGreaterThan(-1);
    expect(versions).toBeGreaterThan(push);
    expect(drift).toBeGreaterThan(versions);
    expect(deploy).toBeGreaterThan(drift);
  });

  it("pins every action to a commit", () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/);
  });
});
