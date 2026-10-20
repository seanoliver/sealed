import "server-only";
import { z } from "zod";
import {
  createContactAs,
  DETAIL_FIELDS,
  mergeNames,
  NAME_FIELDS,
  parseDetails,
  patchContactAs,
  type AgentActor,
  type ContactDiff,
  type DetailField,
  type EmailChange,
  type NamePatch,
  type PatchRequest,
} from "@/app/dashboard/contacts/write";
import { countryCodeFor } from "@/lib/address";
import { type SessionClaims } from "@/lib/auth";
import { validateHousehold } from "@/lib/contacts-sheet";

export type AgentContext = { claims: SessionClaims; tokenId: string };

export const agentActor = (ctx: AgentContext): AgentActor => ({
  source: "agent",
  tokenId: ctx.tokenId,
});

const EMAIL_WAITING =
  "The email change is waiting for the owner to approve on the Agents page; the other fields are saved.";
const EMAIL_WITHDRAWN =
  "The earlier email change was withdrawn. No email change is waiting for the owner.";

export class ToolError extends Error {}

const text = z.string().max(2000);
const clearable = (description: string) =>
  text.nullable().optional().describe(`${description} null or "" clears it.`);

const kidsField = z
  .array(z.object({ first: text, last: text.optional() }))
  .max(20)
  .nullable()
  .optional()
  .describe("Every child, in order; replaces the stored list. null or [] removes them all.");

const detailShape = {
  email: clearable("Primary email."),
  partner_email: clearable("Partner's email; must differ from email."),
  birthday: clearable("YYYY-MM-DD."),
  address_line1: clearable("Street address."),
  address_line2: clearable("Apartment, suite, etc."),
  district: clearable("District, suburb or neighborhood, where the country's format has one (China, South Africa, Mexico)."),
  city: clearable("City or post town."),
  state_region: clearable("State, province or region. US states are saved as their two-letter code."),
  postal_code: clearable("Postal or ZIP code. Checked against the country's format."),
  country: clearable(
    'Country as an English name, a common short form ("UK", "USA") or a two-letter ISO code ("GB").',
  ),
  notes: clearable("The owner's private notes; recipients never see them."),
} satisfies Record<Exclude<DetailField, "country_code"> | "country", unknown>;

const nameShape = {
  first_name: text.optional().describe("The contact's first name. Required on create; can't be cleared."),
  last_name: clearable("The contact's last name."),
  partner_first_name: clearable("Partner's first name. null removes the partner."),
  partner_last_name: clearable("Partner's last name."),
  kids: kidsField,
} satisfies Record<(typeof NAME_FIELDS)[number], unknown>;

export const contactFieldsInput = z
  .strictObject({ ...nameShape, ...detailShape })
  .describe(
    "Only the fields to change. Omitted fields keep their stored values. Names change as a household: the contact's names are filled in from what is stored first.",
  );

type ContactFields = z.output<typeof contactFieldsInput>;

export function toPatchRequest(fields: ContactFields): PatchRequest {
  const values: Partial<Record<DetailField, string>> = {};
  for (const field of DETAIL_FIELDS) {
    if (field !== "country_code" && field in fields) values[field] = fields[field] ?? "";
  }
  if ("country" in fields) {
    const country = fields.country ?? "";
    const code = countryCodeFor(country);
    if (country.trim() !== "" && code === null) {
      throw new ToolError(
        `"${country.slice(0, 60)}" isn't a country I know. Use its English name or two-letter ISO code.`,
      );
    }
    values.country_code = code ?? "";
  }
  const names: NamePatch = {};
  for (const field of NAME_FIELDS) {
    if (field in fields) Object.assign(names, { [field]: fields[field] });
  }
  return { values, names };
}

export const updateContactInput = z.object({
  id: z.uuid().describe("Contact id from search_contacts."),
  fields: contactFieldsInput,
});

export type UpdateContactResult = {
  id: string;
  changed: boolean;
  before?: ContactDiff["before"];
  after?: ContactDiff["after"];
  event_id?: string | null;
  pending_email_change?: { request_id: string; changes: EmailChange; message: string } | null;
  message?: string;
};

export async function updateContact(
  ctx: AgentContext,
  input: z.output<typeof updateContactInput>,
): Promise<UpdateContactResult> {
  const result = await patchContactAs(
    ctx.claims,
    input.id,
    toPatchRequest(input.fields),
    agentActor(ctx),
    { holdEmails: true },
  );
  if (!result.ok) throw new ToolError(result.error);
  const { diff, eventId, emailRequest, emailWithdrawn } = result.value;
  const pending = emailRequest
    ? {
        pending_email_change: {
          request_id: emailRequest.id,
          changes: emailRequest.changes,
          message: EMAIL_WAITING,
        },
      }
    : emailWithdrawn
      ? { pending_email_change: null, message: EMAIL_WITHDRAWN }
      : {};
  return diff
    ? { id: input.id, changed: true, before: diff.before, after: diff.after, event_id: eventId ?? null, ...pending }
    : { id: input.id, changed: false, ...pending };
}

export const createContactInput = z.object({
  fields: contactFieldsInput.extend({ first_name: text.describe("The contact's first name.") }),
});

export async function createContact(
  ctx: AgentContext,
  input: z.output<typeof createContactInput>,
) {
  const { fields } = input;
  const request = toPatchRequest(fields);
  const household = validateHousehold(mergeNames(null, request.names ?? {}));
  if (!household.ok) {
    throw new ToolError(Object.values(household.errors)[0] ?? "Invalid name");
  }
  const details = parseDetails(request.values ?? {});
  if (!details.success) throw new ToolError(details.error);
  const result = await createContactAs(
    ctx.claims,
    { details: details.data, household: household.data },
    agentActor(ctx),
  );
  if (!result.ok) throw new ToolError(result.error);
  return { id: result.value.id, event_id: result.value.eventId ?? null };
}

export const requestDeleteInput = z.object({
  preview_id: z.uuid().describe("preview_id from preview_delete_contacts."),
});

export const previewDeleteContactsInput = z.object({
  ids: z.array(z.uuid()).min(1).max(500).describe("Contact ids to delete (max 500)."),
});

export const undoAgentChangeInput = z.object({
  event_id: z
    .uuid()
    .describe("event_id from a write tool's result, or an agent event id from get_contact's history."),
});
