import { z } from "zod";
import { countryCodeFor } from "@/lib/address/countries";
import { formatKids, formatPerson, type Kid } from "@/lib/names";
import { contactSchema, tokenUpdateSchema, type TokenUpdateField } from "./contact";
import { householdShape, requirePartnerFirstName } from "./household";

/**
 * Helpers for handling `submissions.payload`, which is ATTACKER-CONTROLLED
 * jsonb: the public /b/[slug] flow zod-validates what it stores, but the
 * column may still hold anything an attacker smuggled past it (unknown keys,
 * fields disabled on the book, non-string values) and — defense in depth —
 * even non-object jsonb (the DB CHECK enforces object shape for new rows,
 * but tolerate legacy/hostile shapes anyway). Nothing here trusts the
 * payload; nothing here throws on any input.
 */

/** Per-book optional-field switches (mirrors books.enabled_fields). */
export type EnabledFields = {
  partner_name: boolean;
  kids_names: boolean;
  birthday: boolean;
};

// Household name keys win over legacy name keys. parseSubmissionForDisplay
// must use the same precedence, or the review card shows another name.
const unmatchedCountry = { country: z.string().trim().min(1).max(120).optional() };

export const householdPayloadSchema = tokenUpdateSchema
  .omit({ full_name: true, partner_name: true, kids_names: true })
  .extend(householdShape({ ownerName: "the owner" }))
  .extend(unmatchedCountry)
  .superRefine(requirePartnerFirstName);

const legacyPayloadSchema = tokenUpdateSchema.extend(unmatchedCountry);

export type HouseholdPayload = z.infer<typeof householdPayloadSchema>;
export type LegacyPayload = z.infer<typeof legacyPayloadSchema>;
export type SubmissionPayload = HouseholdPayload | LegacyPayload;

const hasHouseholdNames = (payload: unknown) =>
  typeof payload === "object" &&
  payload !== null &&
  ("first_name" in payload || "last_name" in payload);

export function withCountryCode(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return payload;
  const { country, ...rest } = payload as Record<string, unknown>;
  if (country === undefined || "country_code" in rest) return rest;
  if (typeof country !== "string") return rest;
  if (country.trim() === "") return { ...rest, country_code: "" };
  const code = countryCodeFor(country);
  return code === null ? { ...rest, country } : { ...rest, country_code: code };
}

export function parseSubmissionPayload(
  raw: unknown,
  enabled: EnabledFields,
): { success: true; data: SubmissionPayload } | { success: false } {
  const payload = withCountryCode(raw);
  const parsed = hasHouseholdNames(payload)
    ? householdPayloadSchema.safeParse(payload)
    : legacyPayloadSchema.safeParse(payload);
  return parsed.success
    ? { success: true, data: dropDisabledFields<SubmissionPayload>(parsed.data, enabled) }
    : { success: false };
}

const partnerEmailSchema = z.object({ partner_email: contactSchema.shape.partner_email });

export function parsePartnerEmail(
  payload: unknown,
): { success: true; data: string | undefined } | { success: false } {
  const parsed = partnerEmailSchema.safeParse(payload);
  return parsed.success
    ? { success: true, data: parsed.data.partner_email }
    : { success: false };
}

export function isHouseholdPayload(
  payload: SubmissionPayload,
): payload is HouseholdPayload {
  return "first_name" in payload;
}

/**
 * Display-only cap. Stored values are zod-capped on the legit path (≤2000
 * chars), but a hostile payload only has to fit the 64KB jsonb guard — never
 * let a huge string blow up the review page. Approval paths re-validate the
 * FULL value through parseSubmissionPayload; this truncation is cosmetic.
 */
export const DISPLAY_VALUE_MAX = 200;

const displayValue = z
  .string()
  .transform((s) =>
    s.length > DISPLAY_VALUE_MAX ? `${s.slice(0, DISPLAY_VALUE_MAX)}…` : s,
  )
  .optional()
  // Non-string value under a known key (hostile jsonb) → drop the field
  // rather than failing the whole card.
  .catch(undefined);

const rawName = z.string().optional().catch(undefined);

/**
 * Lenient parser for DISPLAY only (approval uses strict submissionPayloadSchema):
 * accepts any object, DROPS unknown keys (z.object strips them) and
 * non-string values, truncates long values. Rejects non-object payloads
 * (scalar/array/null) — callers render those as "Malformed submission".
 * `notes` is deliberately not here: it is owner-private and can never arrive
 * via a submission; a smuggled `notes` key is an unknown key and is dropped.
 */
export const submissionDisplaySchema = z.object({
  full_name: displayValue,
  partner_name: displayValue,
  kids_names: displayValue,
  email: displayValue,
  partner_email: displayValue,
  birthday: displayValue,
  address_line1: displayValue,
  address_line2: displayValue,
  district: displayValue,
  city: displayValue,
  state_region: displayValue,
  postal_code: displayValue,
  country_code: displayValue,
  country: displayValue,
  first_name: rawName,
  last_name: rawName,
  partner_first_name: rawName,
  partner_last_name: rawName,
  kids: z.array(z.unknown()).optional().catch(undefined),
});

export type SubmissionDisplayFields = Partial<
  Record<TokenUpdateField | "partner_email", string>
> & {
  country?: string;
};

function capDisplay(value: string | null): string | undefined {
  if (value === null) return undefined;
  return value.length > DISPLAY_VALUE_MAX
    ? `${value.slice(0, DISPLAY_VALUE_MAX)}…`
    : value;
}

const displayKid = z.object({
  first: z.string(),
  last: z.string().optional().catch(undefined),
});

function displayKids(items: unknown[]): Kid[] {
  const kids: Kid[] = [];
  for (const item of items.slice(0, 10)) {
    const parsed = displayKid.safeParse(item);
    if (parsed.success) kids.push(parsed.data);
  }
  return kids;
}

const GATED_KEYS: Record<keyof EnabledFields, readonly string[]> = {
  partner_name: ["partner_name", "partner_first_name", "partner_last_name"],
  kids_names: ["kids_names", "kids"],
  birthday: ["birthday"],
};

export function dropDisabledFields<T extends object>(
  data: T,
  enabled: EnabledFields,
): T {
  const out = { ...data } as Record<string, unknown>;
  for (const field of Object.keys(GATED_KEYS) as (keyof EnabledFields)[]) {
    if (enabled[field]) continue;
    for (const key of GATED_KEYS[field]) delete out[key];
  }
  return out as T;
}

/**
 * Lenient display parse: known string fields (truncated, gated) or null for
 * a malformed (non-object) payload. Never throws.
 */
export function parseSubmissionForDisplay(
  payload: unknown,
  enabled: EnabledFields,
): SubmissionDisplayFields | null {
  const parsed = submissionDisplaySchema.safeParse(payload);
  if (!parsed.success) return null;
  const {
    first_name,
    last_name,
    partner_first_name,
    partner_last_name,
    kids,
    country,
    ...rest
  } = dropDisabledFields(parsed.data, enabled);
  const legacyCode = country === undefined ? undefined : countryCodeFor(country);
  const display: SubmissionDisplayFields =
    country === undefined || rest.country_code !== undefined
      ? rest
      : legacyCode
        ? { ...rest, country_code: legacyCode }
        : country.trim() === ""
          ? { ...rest, country_code: "" }
          : { ...rest, country };
  if (first_name === undefined && last_name === undefined) return display;
  return {
    ...display,
    full_name: capDisplay(formatPerson({ first: first_name, last: last_name })),
    // A present but empty partner or kids group reads "" (cleared), not absent.
    partner_name:
      partner_first_name === undefined
        ? undefined
        : (capDisplay(formatPerson({ first: partner_first_name, last: partner_last_name })) ?? ""),
    kids_names:
      kids === undefined
        ? undefined
        : (capDisplay(formatKids({ kids: displayKids(kids), familyLast: last_name })) ?? ""),
  };
}

export type SubmittedPerson = { full: string | null; first: string | null; last: string | null };

export function submittedPeople(payload: unknown, enabled: EnabledFields): SubmittedPerson[] {
  const parsed = submissionDisplaySchema.safeParse(payload);
  if (!parsed.success) return [];
  const data = dropDisabledFields(parsed.data, enabled);
  const person = (
    full: string | undefined,
    first: string | undefined,
    last: string | undefined,
  ): SubmittedPerson => ({
    full: first === undefined && last === undefined ? (full ?? null) : formatPerson({ first, last }),
    first: first ?? null,
    last: last ?? null,
  });
  return [
    person(data.full_name, data.first_name, data.last_name),
    person(data.partner_name, data.partner_first_name, data.partner_last_name),
  ];
}

export const CLEARABLE_FIELDS = [
  "address_line1",
  "address_line2",
  "district",
  "city",
  "state_region",
  "postal_code",
  "country_code",
  "birthday",
  "partner_name",
  "kids_names",
] as const;

export type ClearableField = (typeof CLEARABLE_FIELDS)[number];

const isBlank = (value: unknown) =>
  value === null || (typeof value === "string" && value.trim() === "");

export function withoutBlanks(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return payload;
  }
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([, value]) => !isBlank(value) && !(Array.isArray(value) && value.length === 0),
    ),
  );
}

/** Token replies only: an empty value in a permalink payload never means "clear". */
export function clearedFields(
  payload: unknown,
  enabled: EnabledFields,
): ClearableField[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return [];
  }
  const raw = withCountryCode(payload) as Record<string, unknown>;
  const cleared = new Set<ClearableField>(
    CLEARABLE_FIELDS.filter((field) => field in raw && isBlank(raw[field])),
  );
  if ("partner_first_name" in raw && isBlank(raw.partner_first_name)) {
    cleared.add("partner_name");
  }
  if (Array.isArray(raw.kids) && raw.kids.length === 0) cleared.add("kids_names");
  return [...cleared].filter(
    (field) => !(field in enabled) || enabled[field as keyof EnabledFields],
  );
}
