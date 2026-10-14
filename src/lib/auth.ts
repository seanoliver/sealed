import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** JWT claims shape returned by requireUser; assignable to withRls's claims param. */
export type SessionClaims = { sub: string; email?: string; [k: string]: unknown };

/**
 * Validated JWT claims, or null when signed out. getClaims() verifies the JWT
 * (locally when the project uses asymmetric signing keys; via the Auth server
 * otherwise) rather than trusting the cookie contents. Wrapped in React
 * cache() so the layout gate and page/action calls within one render pass
 * share a single getClaims().
 */
export const currentUser = cache(async (): Promise<SessionClaims | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims as SessionClaims;
});

/** Validated JWT claims or redirect to the sign-in page. Call in every dashboard page/action. */
export async function requireUser(): Promise<SessionClaims> {
  const claims = await currentUser();
  if (!claims) redirect("/");
  return claims;
}

/**
 * Claims of a signed-in admin (ADMIN_EMAILS, comma-separated), otherwise a
 * 404 so the admin surface is invisible to everyone else.
 */
export async function requireAdmin(): Promise<SessionClaims> {
  const claims = await requireUser();
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!claims.email || !admins.includes(claims.email.toLowerCase())) notFound();
  return claims;
}
