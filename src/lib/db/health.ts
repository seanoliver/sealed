import "server-only";
import { sql } from "drizzle-orm";
import { dbAdmin } from "./admin";

export async function pingDatabase(): Promise<void> {
  await dbAdmin.execute(sql`select 1`);
}
