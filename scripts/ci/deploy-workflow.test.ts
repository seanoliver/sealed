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

  it("deploys only by hand or after a successful CI run for a push", () => {
    expect(workflow).toContain(
      "if: >-\n" +
        "      github.event_name == 'workflow_dispatch' ||\n" +
        "      (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push')\n",
    );
  });

  it("refuses a missing or non-pooler database URL and masks it before migrating", () => {
    const push = workflow.indexOf("supabase db push");
    for (const line of [
      'test -n "$DATABASE_URL" || {',
      'url="${DATABASE_URL/.pooler.supabase.com:6543/.pooler.supabase.com:5432}"',
      'password="${url#*://*:}"',
      'echo "::add-mask::$url"',
      'echo "::add-mask::${password%%@*}"',
      '[[ "$url" == *".pooler.supabase.com:5432/"* ]] || {',
    ]) {
      const at = workflow.indexOf(line);
      expect(at, line).toBeGreaterThan(-1);
      expect(at, line).toBeLessThan(push);
    }
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
    expect(workflow).toContain('supabase db push --db-url "$url" --include-all --yes');
    expect(push).toBeGreaterThan(-1);
    expect(versions).toBeGreaterThan(push);
    expect(drift).toBeGreaterThan(versions);
    expect(deploy).toBeGreaterThan(drift);
  });

  it("installs the locked Vercel CLI after migrating, without install scripts, and deploys with it", () => {
    const install = workflow.indexOf("npm ci --ignore-scripts --no-audit --no-fund --prefix scripts/ci/vercel-cli");
    expect(install).toBeGreaterThan(workflow.indexOf("supabase db push"));
    expect(install).toBeLessThan(workflow.indexOf("vercel deploy --prod"));
    expect(workflow.match(/npm (install|ci)/g)).toHaveLength(1);
    expect(workflow).toMatch(/^\s+url=\$\(scripts\/ci\/vercel-cli\/node_modules\/\.bin\/vercel deploy --prod /m);
    expect(workflow).not.toMatch(/npx|\bvercel@/);
  });

  it("does not leave the GitHub token in the checkout", () => {
    expect(workflow).toMatch(/ref: main\n\s+persist-credentials: false/);
  });

  it("pins every action to a commit", () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/);
  });

  it("reads only repository contents and never cancels a running deploy", () => {
    expect(workflow).toMatch(/^permissions:\n  contents: read\n\n/m);
    expect(workflow.match(/permissions:/g)).toHaveLength(1);
    expect(workflow).toContain("concurrency:\n  group: production-deployment\n  cancel-in-progress: false\n");
  });

  it("fails unless sealed.page serves the new deployment, then checks the entry page", () => {
    const deploy = workflow.indexOf("vercel deploy --prod");
    const loop = workflow.indexOf("for attempt in 1 2 3 4 5 6; do");
    const serving = workflow.indexOf('[[ "https://$serving" == "$DEPLOY_URL" ]] && break');
    const fail = workflow.indexOf('[[ $attempt == 6 ]] && { echo "sealed.page serves $serving, not $DEPLOY_URL"; exit 1; }');
    const sleep = workflow.indexOf("sleep 10");
    const login = workflow.indexOf("https://sealed.page/) || true");
    const status = workflow.indexOf('[[ $status == 200 ]] || { echo "sealed.page answered $status"; exit 1; }');
    expect(workflow).toContain("DEPLOY_URL: ${{ steps.deploy.outputs.url }}");
    expect(workflow).toContain('test -n "$url" || { echo "vercel deploy printed no deployment URL"; exit 1; }');
    expect(workflow).toContain(
      '"https://api.vercel.com/v13/deployments/sealed.page?teamId=$VERCEL_ORG_ID" | jq -r .url) ||\n' +
        '              serving="(Vercel API error)"',
    );
    expect(loop).toBeGreaterThan(deploy);
    expect(serving).toBeGreaterThan(loop);
    expect(fail).toBeGreaterThan(serving);
    expect(sleep).toBeGreaterThan(fail);
    expect(login).toBeGreaterThan(sleep);
    expect(status).toBeGreaterThan(login);
  });

  it("bounds every curl", () => {
    const curls = workflow.match(/curl [^\n]*/g) ?? [];
    expect(curls.length).toBeGreaterThan(0);
    for (const line of curls) expect(line).toMatch(/^curl -fsS --max-time 15 --connect-timeout 5 /);
  });
});
