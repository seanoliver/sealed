import { z } from "zod";

// Caps must match the CHECK constraints in migration 0004.
export const NAME_MAX = 80;
export const KIDS_MAX = 10;

export const FIRST_NAME_REQUIRED = "Add your first name.";
export const ROW_FIRST_NAME_REQUIRED = "Add a first name, or remove this row.";
export const lastNameRequired = (ownerName: string) =>
  `Add your last name so ${ownerName} can address your mail.`;
export const OWNER_FIRST_NAME_REQUIRED = "Add a first name.";
export const OWNER_LAST_NAME_REQUIRED = "Add a last name.";
const TOO_LONG = `Keep each name under ${NAME_MAX + 1} characters.`;

const requiredName = (message: string) =>
  z.string().trim().min(1, message).max(NAME_MAX, TOO_LONG);

const optionalName = z
  .string()
  .trim()
  .max(NAME_MAX, TOO_LONG)
  .transform((s) => (s === "" ? undefined : s))
  .optional();

const kidSchema = z.strictObject({
  first: requiredName(ROW_FIRST_NAME_REQUIRED),
  last: optionalName,
});

export type HouseholdVoice = { ownerName?: string };

export function householdShape({ ownerName }: HouseholdVoice = {}) {
  return {
    first_name: requiredName(
      ownerName === undefined ? OWNER_FIRST_NAME_REQUIRED : FIRST_NAME_REQUIRED,
    ),
    last_name: requiredName(
      ownerName === undefined
        ? OWNER_LAST_NAME_REQUIRED
        : lastNameRequired(ownerName),
    ),
    partner_first_name: requiredName(ROW_FIRST_NAME_REQUIRED).optional(),
    partner_last_name: optionalName,
    kids: z
      .array(kidSchema)
      .max(KIDS_MAX, `Add up to ${KIDS_MAX} children.`)
      .transform((kids) => (kids.length === 0 ? undefined : kids))
      .optional(),
  };
}

export function requirePartnerFirstName(
  data: { partner_first_name?: string; partner_last_name?: string },
  ctx: z.RefinementCtx,
): void {
  if (data.partner_last_name !== undefined && data.partner_first_name === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["partner_first_name"],
      message: ROW_FIRST_NAME_REQUIRED,
    });
  }
}

export function householdSchema(voice: HouseholdVoice = {}) {
  return z
    .strictObject(householdShape(voice))
    .superRefine(requirePartnerFirstName);
}

export type HouseholdInput = z.infer<ReturnType<typeof householdSchema>>;

export type HouseholdRow = { first: string; last: string };

export type HouseholdValues = {
  first_name: string;
  last_name: string;
  partner: HouseholdRow | null;
  kids: HouseholdRow[];
};

export const BLANK_HOUSEHOLD_VALUES: HouseholdValues = {
  first_name: "",
  last_name: "",
  partner: null,
  kids: [],
};

/** Field errors keyed by zod path joined with "." (e.g. "kids.1.first"). */
export type HouseholdFieldErrors = Record<string, string>;

export type HouseholdFormResult =
  | { ok: true; values: HouseholdValues; data: HouseholdInput }
  | { ok: false; values: HouseholdValues; fieldErrors?: HouseholdFieldErrors; error?: string };

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value : "";

export function readHouseholdValues(formData: FormData): HouseholdValues {
  const partnerFirst = formData.get("partner_first_name");
  const kidLasts = formData.getAll("kid_last").map(text);
  return {
    first_name: text(formData.get("first_name")),
    last_name: text(formData.get("last_name")),
    partner:
      formData.has("partner_section") && partnerFirst !== null
        ? { first: text(partnerFirst), last: text(formData.get("partner_last_name")) }
        : null,
    kids: formData.has("kids_section")
      ? formData
          .getAll("kid_first")
          .slice(0, KIDS_MAX + 1)
          .map((first, i) => ({ first: text(first), last: kidLasts[i] ?? "" }))
      : [],
  };
}

export function parseHouseholdForm(
  formData: FormData,
  voice: HouseholdVoice = {},
): HouseholdFormResult {
  const values = readHouseholdValues(formData);
  const kidFirsts = formData.getAll("kid_first").map(text);
  const kidLasts = formData.getAll("kid_last").map(text);

  if (formData.has("kids_section") && kidFirsts.length !== kidLasts.length) {
    return { ok: false, values, error: "Something went wrong. Please try again." };
  }

  const parsed = householdSchema(voice).safeParse({
    first_name: values.first_name,
    last_name: values.last_name,
    ...(values.partner
      ? { partner_first_name: values.partner.first, partner_last_name: values.partner.last }
      : {}),
    ...(formData.has("kids_section")
      ? { kids: kidFirsts.map((first, i) => ({ first, last: kidLasts[i] })) }
      : {}),
  });
  if (parsed.success) return { ok: true, values, data: parsed.data };

  const fieldErrors: HouseholdFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".");
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, values, fieldErrors, error: "Check the names below." };
}
