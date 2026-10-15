/**
 * Household name helpers. formatPerson and formatKids must match
 * private.format_person / private.format_kids in
 * supabase/migrations/00000000000004_household_names.sql exactly: the
 * database derives the stored display strings, and these produce the same
 * strings before a row exists (review queue, insert placeholders). The
 * shared fixture in supabase/tests/database/03_household_names.sql guards
 * both sides.
 */

export type Kid = { first: string; last?: string };

const present = (s: string | null | undefined): s is string =>
  s !== null && s !== undefined && s !== "";

/** "First Last", skipping absent parts; null when both are absent. */
export function formatPerson({
  first,
  last,
}: {
  first?: string | null;
  last?: string | null;
}): string | null {
  const parts = [first, last].filter(present);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Kids who share `familyLast` (or have no last name) appear by first name
 * only; everyone else by full name.
 */
export function formatKids({
  kids,
  familyLast,
}: {
  kids: readonly Kid[] | null | undefined;
  familyLast?: string | null;
}): string | null {
  const names = (kids ?? []).map((kid) =>
    !present(kid.last) || kid.last === familyLast
      ? kid.first
      : formatPerson({ first: kid.first, last: kid.last }),
  );
  const joined = names.join(", ");
  return joined === "" ? null : joined;
}

/** Legacy prefill: the last word is the last name ("Mary Ann Smith" → Mary Ann / Smith). */
export function naiveSplit(fullName: string): { first: string; last: string } {
  const words = fullName.trim().split(/\s+/).filter((w) => w !== "");
  if (words.length <= 1) return { first: words[0] ?? "", last: "" };
  return {
    first: words.slice(0, -1).join(" "),
    last: words[words.length - 1],
  };
}

/** Legacy prefill: "Zoe, Max and Ivy" → ["Zoe", "Max", "Ivy"]. */
export function splitKids(kidsNames: string): string[] {
  return kidsNames
    .split(/,|\s+and\s+/i)
    .map((name) => name.trim())
    .filter((name) => name !== "");
}
