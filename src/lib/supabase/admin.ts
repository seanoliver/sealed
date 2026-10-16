import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/env";

/**
 * Supabase Auth admin client. The secret key bypasses every Auth and RLS
 * check, so this is for server-side admin calls only (today: the beta
 * invitation's sign-in link). Imports are lint-restricted like dbAdmin.
 */
export function createAdminAuthClient() {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
