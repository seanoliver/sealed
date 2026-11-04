import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Production's app_server role reads only these columns; CI runs as postgres,
// so any other column passes every test and fails in production.
const GRANTED = new Set(["id", "email", "email_confirmed_at"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("app SQL against auth.users", () => {
  it("reads only the columns the production role is granted", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.resolve(__dirname, "../.."))) {
      const text = readFileSync(file, "utf8");
      for (const [, alias] of text.matchAll(/auth\.users\s+(?:as\s+)?(\w+)/g)) {
        for (const [, column] of text.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, "g"))) {
          if (!GRANTED.has(column)) offenders.push(`${path.relative(process.cwd(), file)}: ${alias}.${column}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
