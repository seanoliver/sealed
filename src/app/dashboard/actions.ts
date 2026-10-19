"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { withRls } from "@/lib/db";
// Sanctioned dbAdmin import (allowlisted in eslint.config.mjs): update_tokens
// has zero grants for client roles by design, so token minting/cleanup and
// email_sends bookkeeping go through the admin connection. The contact ids
// they operate on come exclusively from the RLS-scoped select below — the
// RLS query IS the authorization.
import { dbAdmin } from "@/lib/db/admin";
import { books, contacts, emailSends, profiles, updateTokens } from "@/lib/db/schema";
import { isEmailDryRun, sendAddressRequests } from "@/lib/email/resend";
import { addressRequestEmail } from "@/lib/email/templates";
import { logDbError } from "@/lib/log";
import { generateToken, TOKEN_TTL_DAYS } from "@/lib/tokens";

// Explicit ids only — no "send to everything" mode. The client sends the ids
// of the rows it actually displayed, so what the user confirmed in the dialog
// is exactly what fans out (a search-filtered "Send to all" must not quietly
// email — and rotate the live links of — the rest of the book).
const requestSchema = z.object({
  contactIds: z.array(z.uuid()).min(1).max(1000),
});

export type RequestAddressesInput = z.input<typeof requestSchema>;

export type RequestAddressesResult =
  | { sent: number; skippedNoEmail: number; failed: number; failedContactIds: string[] }
  | { error: string };

/**
 * Mint update tokens for the targeted contacts and email each a personal
 * `/u/<token>` link. Single-active-token semantics: once a contact's new
 * email is confirmed sent, their older unused links stop working.
 *
 * Invariant: the raw token exists only transiently to build the email URL.
 * Only its sha256 is persisted, and it is never logged here (the dev-only
 * EMAIL_DRY_RUN path inside the email layer is the sole exception).
 */
export async function requestAddresses(
  input: RequestAddressesInput,
): Promise<RequestAddressesResult> {
  const claims = await requireUser();

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request." };

  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error("APP_URL is not set");
  // Validate email config BEFORE minting, or a throw mid-send leaves live
  // tokens for emails that never went out. Same predicate the email layer uses.
  if (!isEmailDryRun()) {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
    if (!process.env.EMAIL_FROM) throw new Error("EMAIL_FROM is not set");
  }

  // Authorization = RLS: this select can only ever return the caller's own
  // contacts. Ids belonging to another user silently drop out here.
  let scope:
    | {
        bookId: string;
        ownerName: string;
        rows: { id: string; email: string | null }[];
      }
    | undefined;
  try {
    scope = await withRls(claims, async (tx) => {
      const [book] = await tx
        .select({ id: books.id })
        .from(books)
        .where(eq(books.ownerId, claims.sub))
        .limit(1);
      if (!book) return undefined;

      const [profile] = await tx
        .select({ displayName: profiles.displayName })
        .from(profiles)
        .where(eq(profiles.id, claims.sub))
        .limit(1);

      const rows = await tx
        .select({ id: contacts.id, email: contacts.email })
        .from(contacts)
        .where(
          and(
            eq(contacts.bookId, book.id),
            inArray(contacts.id, parsed.data.contactIds),
          ),
        );

      return {
        bookId: book.id,
        ownerName: profile?.displayName.trim() ?? "",
        rows,
      };
    });
  } catch (err) {
    logDbError("[ra] [requestAddresses] contact select failed", err);
    return { error: "Something went wrong. Please try again." };
  }
  if (!scope) return { error: "Set up your address book first." };

  const targets = scope.rows.filter(
    (row): row is { id: string; email: string } => row.email !== null,
  );
  const skippedNoEmail = scope.rows.length - targets.length;
  if (targets.length === 0) {
    return { sent: 0, skippedNoEmail, failed: 0, failedContactIds: [] };
  }

  // Hashes are persisted BEFORE the emails go out so a recipient clicking
  // instantly always finds a live row. Old links stay live until the new
  // email is confirmed sent, so a failed send never strands a contact.
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const minted = targets.map((target) => {
    const { token, hash } = generateToken();
    return { target, token, hash };
  });

  let mintedAt: Date;
  try {
    const [first] = await dbAdmin
      .insert(updateTokens)
      .values(
        minted.map(({ target, hash }) => ({
          contactId: target.id,
          tokenHash: hash,
          expiresAt,
        })),
      )
      .returning({ createdAt: updateTokens.createdAt });
    mintedAt = first.createdAt;
  } catch (err) {
    logDbError("[ra] [requestAddresses] token mint failed", err);
    return { error: "Something went wrong. Please try again." };
  }

  const results = await sendAddressRequests(
    minted.map(({ target, token }) => ({
      to: target.email,
      ...addressRequestEmail({
        ownerName: scope.ownerName,
        updateUrl: `${appUrl}/u/${token}`,
      }),
    })),
    { batchKey: randomUUID() },
  );

  // Positional: results[i] corresponds to minted[i].
  const paired = minted.map((mint, i) => ({ ...mint, result: results[i] }));
  const delivered = paired.flatMap((p) =>
    p.result.status === "sent" ? [{ ...p, resendId: p.result.id }] : [],
  );
  const rejected = paired.filter((p) => p.result.status === "failed");
  const failedContactIds = paired
    .filter((p) => p.result.status !== "sent")
    .map((p) => p.target.id);

  try {
    await dbAdmin.transaction(async (tx) => {
      if (delivered.length > 0) {
        await tx.insert(emailSends).values(
          delivered.map(({ target, resendId }) => ({
            contactId: target.id,
            bookId: scope.bookId,
            resendId,
            status: "sent",
          })),
        );
        // createdAt < mintedAt: a newer concurrent send's link must survive.
        await tx.delete(updateTokens).where(
          and(
            inArray(
              updateTokens.contactId,
              delivered.map(({ target }) => target.id),
            ),
            isNull(updateTokens.usedAt),
            lt(updateTokens.createdAt, mintedAt),
          ),
        );
      }
      // A rejected email never went out, so its token must not stay live.
      // An unconfirmed one may have, so it keeps both links.
      if (rejected.length > 0) {
        await tx.delete(updateTokens).where(
          inArray(
            updateTokens.tokenHash,
            rejected.map(({ hash }) => hash),
          ),
        );
      }
    });
  } catch (err) {
    // No error result: the emails went out, and a retry would send them twice.
    logDbError("[ra] [requestAddresses] send bookkeeping failed", err);
  }

  revalidatePath("/dashboard");
  return {
    sent: delivered.length,
    skippedNoEmail,
    failed: failedContactIds.length,
    failedContactIds,
  };
}
