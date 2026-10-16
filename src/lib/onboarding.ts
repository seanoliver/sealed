import type { SupabaseClient, UserIdentity } from "@supabase/supabase-js";
import { BOOK_LINK_SHAPE } from "@/lib/book-link";

const FALLBACK_LINK_NAME = "my-address-book";

/**
 * Build an editable initial link name from the authenticated email alias.
 * This is a suggestion only; it is never regenerated over an owner's edit.
 */
export function suggestLinkName(email: string): string {
  const alias = (email.split("@", 1)[0] ?? "").split("+", 1)[0] ?? "";
  const suggestion = alias
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return BOOK_LINK_SHAPE.test(suggestion) ? suggestion : FALLBACK_LINK_NAME;
}

/** The name on a linked Google identity. User metadata is not read: a direct signUp can set it. */
export function authDisplayName(identities: UserIdentity[] | undefined): string {
  const values = identities?.find((identity) => identity.provider === "google")?.identity_data;
  if (!values) return "";

  for (const key of ["full_name", "name"] as const) {
    const value = values[key];
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (name) return name.slice(0, 200).trim();
  }
  return "";
}

export async function googleDisplayName(supabase: Pick<SupabaseClient, "auth">): Promise<string> {
  const { data } = await supabase.auth.getUser();
  return authDisplayName(data.user?.identities);
}
