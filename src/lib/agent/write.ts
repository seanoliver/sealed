import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  createContactAs,
  DETAIL_FIELDS,
  NAME_FIELDS,
  parseDetails,
  patchContactAs,
  type Actor,
  type DetailField,
  type NamePatch,
  type PatchRequest,
} from "@/app/dashboard/contacts/write";
import { approveMergeAs, approveNewAs, rejectAs } from "@/app/dashboard/review/resolve";
import { type SessionClaims } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { householdSchema } from "@/lib/validation/household";

export type AgentContext = { claims: SessionClaims; tokenId: string };

export const agentActor = (ctx: AgentContext): Actor => ({ source: "agent", tokenId: ctx.tokenId });

/** A tool-level refusal the agent should read and act on (not a server fault). */
export class ToolError extends Error {}

// Loose shapes only: the shared contact schemas do the real validation.
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
  city: clearable("City."),
  state_region: clearable("State, province or region."),
  postal_code: clearable("Postal or ZIP code."),
  country: clearable("Country."),
  notes: clearable("The owner's private notes; recipients never see them."),
} satisfies Record<DetailField, unknown>;

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
    if (field in fields) values[field] = fields[field] ?? "";
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

export async function updateContact(
  ctx: AgentContext,
  input: z.output<typeof updateContactInput>,
) {
  const result = await patchContactAs(ctx.claims, input.id, toPatchRequest(input.fields), agentActor(ctx));
  if (!result.ok) throw new ToolError(result.error);
  const { diff, eventId } = result.value;
  return diff
    ? { id: input.id, changed: true, before: diff.before, after: diff.after, event_id: eventId ?? null }
    : { id: input.id, changed: false };
}

export const createContactInput = z.object({
  fields: contactFieldsInput.extend({ first_name: text.describe("The contact's first name.") }),
});

export async function createContact(
  ctx: AgentContext,
  input: z.output<typeof createContactInput>,
) {
  const { fields } = input;
  const household = householdSchema().safeParse({
    first_name: fields.first_name,
    last_name: fields.last_name ?? undefined,
    partner_first_name: fields.partner_first_name?.trim() ? fields.partner_first_name : undefined,
    partner_last_name: fields.partner_last_name ?? undefined,
    kids: fields.kids ?? undefined,
  });
  if (!household.success) {
    throw new ToolError(household.error.issues[0]?.message ?? "Invalid name");
  }
  const details = parseDetails(toPatchRequest(fields).values ?? {});
  if (!details.success) throw new ToolError(details.error);
  const result = await createContactAs(
    ctx.claims,
    { details: details.data, household: household.data },
    agentActor(ctx),
  );
  if (!result.ok) throw new ToolError(result.error);
  return { id: result.value.id, event_id: result.value.eventId ?? null };
}

export const resolveReviewItemInput = z.object({
  id: z.uuid().describe("Submission id from list_review_queue."),
  action: z
    .enum(["approve", "reject"])
    .describe(
      "approve: merge the reply into its matched contact, or add it as a new contact when it matched none. reject: discard it.",
    ),
});

export async function resolveReviewItem(
  ctx: AgentContext,
  input: z.output<typeof resolveReviewItemInput>,
) {
  if (input.action === "reject") {
    const result = await rejectAs(ctx.claims, input.id);
    if (!result.ok) throw new ToolError(result.error);
    return { id: input.id, status: "rejected" };
  }
  const [submission] = await withRls(ctx.claims, (tx) =>
    tx
      .select({ matchedContactId: submissions.matchedContactId })
      .from(submissions)
      .where(and(eq(submissions.id, input.id), eq(submissions.status, "pending")))
      .limit(1),
  );
  const approve = submission?.matchedContactId ? approveMergeAs : approveNewAs;
  const result = await approve(ctx.claims, input.id, agentActor(ctx));
  if (!result.ok) throw new ToolError(result.error);
  return {
    id: input.id,
    status: "approved",
    contact_id: result.contactId ?? null,
    event_id: result.eventId ?? null,
  };
}

const changeInput = z.object({ id: z.uuid(), fields: contactFieldsInput });

export const previewBulkUpdateInput = z.object({
  changes: z
    .array(changeInput)
    .min(1)
    .max(500)
    .describe("One entry per contact (max 500), each with only the fields to change."),
});

export const applyPreviewInput = z.object({
  preview_id: z.uuid().describe("preview_id from the matching preview tool."),
});

export const previewDeleteContactsInput = z.object({
  ids: z.array(z.uuid()).min(1).max(500).describe("Contact ids to delete (max 500)."),
});

export const undoAgentChangeInput = z.object({
  event_id: z
    .uuid()
    .describe("event_id from a write tool's result, or an agent event id from get_contact's history."),
});
