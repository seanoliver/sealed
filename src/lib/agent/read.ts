import "server-only";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type SessionClaims } from "@/lib/auth";
import { effectiveSends, type EffectiveSends, type StatusKey } from "@/lib/contacts-sheet";
import { contactsToCsv } from "@/lib/csv/export";
import { withRls } from "@/lib/db";
import { emailSends, submissions } from "@/lib/db/schema";
import { type FailureReason } from "@/lib/email/resend";
import { householdLine, pickStoredNames, type StoredNames } from "@/lib/names";
import { getOwnBook } from "@/lib/queries/books";
import {
  getContactWithEvents,
  listContacts,
  SEND_STATUSES,
  type ContactListRow,
  type SendStatus,
} from "@/lib/queries/contacts";
import { listCsvRows } from "@/lib/queries/export";
import { listPendingSubmissions } from "@/lib/queries/submissions";
import { type Recipient } from "@/lib/recipients";
import {
  parseSubmissionForDisplay,
  type SubmissionDisplayFields,
} from "@/lib/validation/submission";

const pageField = z.int().min(1).default(1).describe("1-based page number.");
const limitField = (max: number, fallback: number) =>
  z.int().min(1).max(max).default(fallback).describe(`Items per page (max ${max}).`);

type Paging = { page: number; limit: number };
export type Page<T> = { total: number; page: number; limit: number; items: T[] };

function paginate<T>(items: readonly T[], { page, limit }: Paging): Page<T> {
  return { total: items.length, page, limit, items: items.slice((page - 1) * limit, page * limit) };
}

const blank = (value: string | null | undefined) => (value ?? "").trim() === "";

export const GAP_FIELDS = ["street", "city", "postal_code", "country"] as const;
export type GapField = (typeof GAP_FIELDS)[number];

function addressGaps(row: ContactListRow): GapField[] {
  const values: Record<GapField, string | null> = {
    street: row.addressLine1,
    city: row.city,
    postal_code: row.postalCode,
    country: row.country,
  };
  return GAP_FIELDS.filter((field) => blank(values[field]));
}

function isCouple(names: StoredNames): boolean {
  return !blank(names.partnerFirstName) || !blank(names.partnerName);
}

export type ContactSummary = {
  id: string;
  name: string;
  email: string | null;
  partnerEmail: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
  country: string | null;
  status: StatusKey;
  needsAttention: boolean;
  attention: EffectiveSends["attention"];
  updatedAfterSend: boolean;
  missing: (GapField | "email")[];
};

const STATUS_FILTERS = ["none", ...SEND_STATUSES, "updated"] as const;

function summarize(row: ContactListRow): ContactSummary {
  const { status, attention } = effectiveSends(row);
  return {
    id: row.id,
    name: householdLine(pickStoredNames(row)),
    email: row.email,
    partnerEmail: row.partnerEmail,
    city: row.city,
    stateRegion: row.stateRegion,
    postalCode: row.postalCode,
    country: row.country,
    status,
    needsAttention: attention.length > 0,
    attention,
    updatedAfterSend: row.updatedAfterSend,
    missing: [...addressGaps(row), ...(blank(row.email) ? (["email"] as const) : [])],
  };
}

export const searchContactsInput = z.object({
  query: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Case-insensitive text matched against names, emails and city."),
  status: z
    .enum(STATUS_FILTERS)
    .optional()
    .describe(
      "Status as the dashboard shows it: 'updated' when the recipient replied after the last send, otherwise the best latest send among people who still have an email. 'none' means never emailed.",
    ),
  needs_attention: z
    .boolean()
    .optional()
    .describe(
      "True: someone who still has an email has a latest send that failed, bounced, complained or was never confirmed, and the contact has not replied since.",
    ),
  missing_address: z
    .boolean()
    .optional()
    .describe("True: missing street, city, postal code or country. False: all four present."),
  missing_email: z.boolean().optional().describe("True: the contact has no email (partner email aside)."),
  country: z.string().trim().max(120).optional().describe("Exact country, case-insensitive."),
  couples_only: z.boolean().optional().describe("True: only contacts with a partner."),
  page: pageField,
  limit: limitField(100, 25),
});

export async function searchContacts(
  claims: SessionClaims,
  input: z.output<typeof searchContactsInput>,
): Promise<Page<ContactSummary>> {
  const rows = await listContacts(claims);
  const query = input.query?.toLowerCase();
  const country = input.country?.toLowerCase();
  const matches = rows.flatMap((row) => {
    const summary = summarize(row);
    return keep(row, summary) ? [summary] : [];
  });
  return paginate(matches, input);

  function keep(row: ContactListRow, summary: ContactSummary): boolean {
    if (query) {
      const haystack = [
        householdLine(pickStoredNames(row)),
        row.fullName,
        row.partnerName,
        row.email,
        row.partnerEmail,
        row.city,
      ];
      if (!haystack.some((value) => value?.toLowerCase().includes(query))) return false;
    }
    if (input.status !== undefined && summary.status !== input.status) return false;
    if (input.needs_attention !== undefined && summary.needsAttention !== input.needs_attention) {
      return false;
    }
    if (
      input.missing_address !== undefined &&
      addressGaps(row).length > 0 !== input.missing_address
    ) {
      return false;
    }
    if (input.missing_email !== undefined && blank(row.email) !== input.missing_email) return false;
    if (country !== undefined && (row.country ?? "").trim().toLowerCase() !== country) return false;
    if (input.couples_only && !isCouple(row)) return false;
    return true;
  }
}

export const getContactInput = z.object({
  id: z.uuid().describe("Contact id from search_contacts."),
  events_limit: z
    .int()
    .min(0)
    .max(100)
    .default(10)
    .describe("How many history entries to include, newest first (max 100)."),
});

type SendRow = {
  recipient: Recipient;
  status: string;
  failureReason: FailureReason | null;
  sentAt: Date;
};

export async function getContact(claims: SessionClaims, input: z.output<typeof getContactInput>) {
  const detail = await getContactWithEvents(claims, input.id);
  if (!detail) return null;
  const sends: SendRow[] = await withRls(claims, (tx) =>
    tx
      .select({
        recipient: emailSends.recipient,
        status: emailSends.status,
        failureReason: emailSends.failureReason,
        sentAt: emailSends.sentAt,
      })
      .from(emailSends)
      .where(eq(emailSends.contactId, input.id))
      .orderBy(desc(emailSends.sentAt), desc(emailSends.id))
      .limit(20),
  );
  const latest = (recipient: Recipient) => {
    const send = sends.find((row) => row.recipient === recipient);
    return send
      ? { status: send.status as SendStatus, failureReason: send.failureReason, sentAt: send.sentAt }
      : { status: "none" as const, failureReason: null, sentAt: null };
  };
  const primary = latest("primary");
  const partner = latest("partner");
  const { contact, events } = detail;
  const sentTimes = [primary.sentAt, partner.sentAt].flatMap((at) => (at ? [at.getTime()] : []));
  const updatedAfterSend =
    sentTimes.length > 0 &&
    events.some(
      (event) => event.source === "token" && event.createdAt.getTime() > Math.max(...sentTimes),
    );
  const { status, failureReason, attention } = effectiveSends({
    email: contact.email,
    partnerEmail: contact.partnerEmail,
    sendStatuses: { primary, partner },
    updatedAfterSend,
  });
  return {
    contact: { ...contact, name: householdLine(pickStoredNames(contact)) },
    sendStatus: {
      status,
      failureReason,
      needsAttention: attention.length > 0,
      attention,
      updatedAfterSend,
      primary,
      partner,
    },
    recentSends: sends,
    events: events.slice(0, input.events_limit).map((event) => ({
      id: event.id,
      source: event.source,
      agent: event.source === "agent" ? event.agentName : undefined,
      recipient: event.recipient,
      diff: fenceUntrusted(event.diff),
      createdAt: event.createdAt,
    })),
  };
}

const MAX_DIFF_CHARS = 2000;

export function fenceUntrusted(value: unknown): string {
  const json = JSON.stringify(value) ?? "null";
  const capped =
    json.length > MAX_DIFF_CHARS ? `${json.slice(0, MAX_DIFF_CHARS)}… (truncated)` : json;
  return `<untrusted-data>${capped.replaceAll("</untrusted-data>", "")}</untrusted-data>`;
}

export const bookSummaryInput = z.object({});

export async function bookSummary(claims: SessionClaims) {
  const [rows, [pending]] = await Promise.all([
    listContacts(claims),
    withRls(claims, (tx) =>
      tx.select({ n: count() }).from(submissions).where(eq(submissions.status, "pending")),
    ),
  ]);

  const byStatus = Object.fromEntries(
    STATUS_FILTERS.map((status) => [status, 0]),
  ) as Record<StatusKey, number>;
  const countries = new Map<string, { country: string | null; count: number }>();
  const missing = { street: 0, city: 0, postal_code: 0, country: 0, any_address_field: 0, email: 0 };
  let couples = 0;
  let needsAttention = 0;
  let updatedAfterSend = 0;

  for (const row of rows) {
    const { status, attention } = effectiveSends(row);
    byStatus[status] += 1;
    if (attention.length > 0) needsAttention += 1;
    if (row.updatedAfterSend) updatedAfterSend += 1;
    if (isCouple(row)) couples += 1;
    const gaps = addressGaps(row);
    for (const gap of gaps) missing[gap] += 1;
    if (gaps.length > 0) missing.any_address_field += 1;
    if (blank(row.email)) missing.email += 1;
    const label = blank(row.country) ? null : row.country!.trim();
    const key = label?.toLowerCase() ?? "";
    const entry = countries.get(key) ?? { country: label, count: 0 };
    entry.count += 1;
    countries.set(key, entry);
  }

  return {
    contacts: rows.length,
    couples,
    needsAttention,
    updatedAfterSend,
    byStatus,
    byCountry: [...countries.values()].sort((a, b) => b.count - a.count),
    missing,
    pendingReview: pending?.n ?? 0,
  };
}

export const addressGapsInput = z.object({
  page: pageField,
  limit: limitField(200, 25).describe("Contacts listed per group (max 200)."),
});

export async function listAddressGaps(
  claims: SessionClaims,
  input: z.output<typeof addressGapsInput>,
) {
  const rows = await listContacts(claims);
  const counts: Record<GapField, number> = { street: 0, city: 0, postal_code: 0, country: 0 };
  const groups = new Map<string, { missing: GapField[]; contacts: ContactSummary[] }>();
  for (const row of rows) {
    const gaps = addressGaps(row);
    if (gaps.length === 0) continue;
    for (const gap of gaps) counts[gap] += 1;
    const key = gaps.join(",");
    const group = groups.get(key) ?? { missing: gaps, contacts: [] };
    group.contacts.push(summarize(row));
    groups.set(key, group);
  }
  return {
    total: [...groups.values()].reduce((sum, group) => sum + group.contacts.length, 0),
    counts,
    groups: [...groups.values()]
      .sort((a, b) => b.contacts.length - a.contacts.length)
      .map(({ missing, contacts }) => {
        const { total, page, limit, items } = paginate(contacts, input);
        return { missing, count: total, page, limit, contacts: items };
      }),
  };
}

const STREET_WORDS: Record<string, string> = {
  street: "st",
  avenue: "ave",
  road: "rd",
  drive: "dr",
  lane: "ln",
  boulevard: "blvd",
  court: "ct",
  place: "pl",
  apartment: "apt",
  suite: "ste",
};

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeStreet(value: string): string {
  return normalizeText(value)
    .split(" ")
    .map((word) => STREET_WORDS[word] ?? word)
    .join(" ");
}

export const findDuplicatesInput = z.object({
  page: pageField,
  limit: limitField(100, 25).describe("Duplicate groups per page (max 100)."),
});

export type DuplicateGroup = {
  reasons: string[];
  contacts: (ContactSummary & { addressLine1: string | null })[];
};

export async function findDuplicates(
  claims: SessionClaims,
  input: z.output<typeof findDuplicatesInput>,
): Promise<Page<DuplicateGroup>> {
  const rows = await listContacts(claims);
  const holders = new Map<string, { reason: string; indices: number[] }>();
  rows.forEach((row, index) => {
    for (const [key, reason] of duplicateKeys(row)) {
      const entry = holders.get(key) ?? { reason, indices: [] };
      if (!entry.indices.includes(index)) entry.indices.push(index);
      holders.set(key, entry);
    }
  });

  const parent = rows.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const { indices } of holders.values()) {
    for (const index of indices.slice(1)) parent[find(index)] = find(indices[0]);
  }

  const groups = new Map<number, { reasons: Set<string>; indices: Set<number> }>();
  for (const { reason, indices } of holders.values()) {
    if (indices.length < 2) continue;
    const root = find(indices[0]);
    const group = groups.get(root) ?? { reasons: new Set(), indices: new Set() };
    group.reasons.add(reason);
    for (const index of indices) group.indices.add(index);
    groups.set(root, group);
  }

  const result: DuplicateGroup[] = [...groups.values()]
    .map(({ reasons, indices }) => [...indices].sort((a, b) => a - b).map((i) => ({ i, reasons })))
    .sort((a, b) => a[0].i - b[0].i)
    .map((members) => ({
      reasons: [...members[0].reasons],
      contacts: members.map(({ i }) => ({ ...summarize(rows[i]), addressLine1: rows[i].addressLine1 })),
    }));
  return paginate(result, input);
}

function duplicateKeys(row: ContactListRow): [key: string, reason: string][] {
  const keys: [string, string][] = [];
  for (const email of [row.email, row.partnerEmail]) {
    if (blank(email)) continue;
    const normalized = email!.trim().toLowerCase();
    keys.push([`email:${normalized}`, `same email ${normalized}`]);
  }
  const street = normalizeStreet(row.addressLine1 ?? "");
  if (street !== "") {
    for (const name of new Set([householdLine(pickStoredNames(row)), row.fullName])) {
      const normalized = normalizeText(name);
      if (normalized !== "") keys.push([`home:${normalized}|${street}`, "same household name and street"]);
    }
  }
  return keys;
}

export const reviewQueueInput = z.object({
  page: pageField,
  limit: limitField(100, 25),
});

export type ReviewItem = {
  id: string;
  createdAt: Date;
  source: "permalink" | "token";
  from: Recipient | null;
  savedBy: Recipient | null;
  matchedContact: { id: string; name: string } | null;
  fields: SubmissionDisplayFields | null;
};

export async function listReviewQueue(
  claims: SessionClaims,
  input: z.output<typeof reviewQueueInput>,
): Promise<Page<ReviewItem>> {
  const [book, pending] = await Promise.all([getOwnBook(claims), listPendingSubmissions(claims)]);
  if (!book) return paginate([], input);
  return paginate(
    pending.map(({ submission, matchedContact }) => ({
      id: submission.id,
      createdAt: submission.createdAt,
      source: submission.source,
      from: submission.recipient,
      savedBy: submission.savedBy,
      matchedContact: matchedContact
        ? { id: matchedContact.id, name: householdLine(pickStoredNames(matchedContact)) }
        : null,
      fields: parseSubmissionForDisplay(submission.payload, book.enabledFields),
    })),
    input,
  );
}

export const exportContactsInput = z.object({
  page: pageField,
  limit: limitField(2000, 1000).describe("Rows per page (max 2000). Every page repeats the header."),
});

export async function exportContacts(
  claims: SessionClaims,
  input: z.output<typeof exportContactsInput>,
) {
  const { items, ...page } = paginate(await listCsvRows(claims), input);
  return { ...page, csv: contactsToCsv(items) };
}
