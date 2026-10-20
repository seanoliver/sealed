import {
  pgTable, uuid, text, jsonb, timestamp, date, customType,
} from "drizzle-orm/pg-core";
import type { Kid } from "../names";
import type { Recipient } from "../recipients";
import type { AgentScope } from "../agent/scopes";

const citext = customType<{ data: string }>({ dataType: () => "citext" });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull(),
  slug: text("slug").notNull(),
  enabledFields: jsonb("enabled_fields").notNull().$type<{
    partner_name: boolean; kids_names: boolean; birthday: boolean;
  }>().default({ partner_name: false, kids_names: false, birthday: false }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull(),
  fullName: text("full_name").notNull(),
  partnerName: text("partner_name"),
  kidsNames: text("kids_names"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  partnerFirstName: text("partner_first_name"),
  partnerLastName: text("partner_last_name"),
  kids: jsonb("kids").$type<Kid[]>(),
  email: citext("email"),
  partnerEmail: citext("partner_email"),
  birthday: date("birthday"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  stateRegion: text("state_region"),
  postalCode: text("postal_code"),
  country: text("country"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  status: text("status").notNull().default("pending"),
  matchedContactId: uuid("matched_contact_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  source: text("source").$type<"permalink" | "token">().notNull().default("permalink"),
  recipient: text("recipient").$type<Recipient>(),
  savedBy: text("saved_by").$type<Recipient>(),
});

export const updateTokens = pgTable("update_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull(),
  tokenHash: bytea("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  recipient: text("recipient").$type<Recipient>().notNull().default("primary"),
});

export const emailSends = pgTable("email_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull(),
  bookId: uuid("book_id").notNull(),
  resendId: text("resend_id"),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  failureReason: text("failure_reason").$type<"rejected" | "quota" | "error">(),
  recipient: text("recipient").$type<Recipient>().notNull().default("primary"),
});

export const contactEvents = pgTable("contact_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull(),
  source: text("source").notNull(),
  diff: jsonb("diff").notNull(),
  recipient: text("recipient").$type<Recipient>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  agentTokenId: uuid("agent_token_id"),
  agentPreviewId: uuid("agent_preview_id"),
  contactUpdatedAt: timestamp("contact_updated_at", { withTimezone: true }),
});

export const agentTokens = pgTable("agent_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  tokenHash: bytea("token_hash").notNull(),
  scopes: text("scopes").array().notNull().$type<AgentScope[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const agentPreviews = pgTable("agent_previews", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  agentTokenId: uuid("agent_token_id").notNull(),
  kind: text("kind").$type<"update" | "delete">().notNull(),
  items: jsonb("items").notNull().$type<unknown[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  discardedAt: timestamp("discarded_at", { withTimezone: true }),
});
