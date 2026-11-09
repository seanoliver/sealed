import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

describe("dbAdmin.transaction lint rule", () => {
  it("rejects a bare dbAdmin.transaction outside admin.ts", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [result] = await eslint.lintText(
      'import { dbAdmin } from "@/lib/db/admin";\nexport const run = () => dbAdmin.transaction(async () => 1);\n',
      { filePath: "src/app/dashboard/actions.ts" },
    );
    expect(result.messages.map((m) => m.ruleId)).toContain("no-restricted-syntax");
  }, 30_000);
});
