import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** JWT claims shape returned by requireUser; assignable to withRls's claims param. */
export type SessionClaims = { sub: string; email?: string; [k: string]: unknown };

/** Verified JWT claims, or null when signed out. Not getSession(): it trusts the cookie. */
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

export async function requireAdmin(): Promise<SessionClaims> {
  const claims = await requireUser();
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!claims.email || !admins.includes(claims.email.toLowerCase())) notFound();
  return claims;
}
