import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { mintAgentToken, type AgentTokenInput } from "@/lib/agent/tokens";
import { dbAdmin } from "@/lib/db/admin";

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      scopes: { type: "string", default: "read" },
      "expires-days": { type: "string" },
    },
  });
  if (!values.email || !values.name) {
    throw new Error("Usage: --email <owner email> --name <token name> [--scopes read,write] [--expires-days N]");
  }

  const [user] = await dbAdmin.execute<{ id: string }>(
    sql`select id from auth.users where lower(email) = lower(${values.email})`,
  );
  if (!user) throw new Error(`No user with email ${values.email}`);

  const { token, summary } = await mintAgentToken(user.id, {
    name: values.name,
    scopes: values.scopes.split(",").map((scope) => scope.trim()) as AgentTokenInput["scopes"],
    expiresInDays:
      values["expires-days"] === undefined ? undefined : Number(values["expires-days"]),
  });

  console.log(`Created "${summary.name}" (${summary.scopes.join(", ")}), id ${summary.id}`);
  console.log(`Expires: ${summary.expiresAt?.toISOString() ?? "never"}`);
  console.log(`\n${token}\n\nCopy it now; it cannot be shown again.`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
