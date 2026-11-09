import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { assertServerEnv } from "@/lib/env";
import * as schema from "./schema";

// Single choke point: every server path that touches data imports this
// module (directly or via withRls), so a deployment missing required env
// vars fails at first touch with a clear list instead of deep in a request.
assertServerEnv();

// Explicit guard (and type narrowing): postgres.js silently falls back to
// localhost:5432 when the connection string is undefined — fail loudly.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const client = postgres(url, {
  prepare: false,
  max: 1,
  // Serverless: warm instances must not hold connections forever.
  idle_timeout: 20, // seconds
  max_lifetime: 60 * 30, // seconds
});

/**
 * Admin connection — BYPASSES RLS (connection role owns the tables).
 * Allowed uses: calling private.* SECURITY DEFINER functions, minting
 * update_tokens, webhook status updates. NEVER use for owner-facing reads.
 * Importing this module is lint-restricted to the sanctioned call sites
 * (see no-restricted-imports in eslint.config.mjs) — owner-facing access
 * goes through withRls in `@/lib/db`.
 */
export const dbAdmin = drizzle(client, { schema });
