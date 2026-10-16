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

/** Read only genuine human-name claims supplied by an identity provider. */
export function authDisplayName(claims: Record<string, unknown>): string {
  // Matches private.handle_new_user: any other provider lets the signer-up choose the name.
  const app = claims.app_metadata as { provider?: unknown } | undefined;
  if (app?.provider !== "google") return "";
  const metadata = claims.user_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "";
  }

  const values = metadata as Record<string, unknown>;
  for (const key of ["full_name", "name"] as const) {
    const value = values[key];
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (name) return name.slice(0, 200).trim();
  }
  return "";
}
