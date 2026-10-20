"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { approveMergeAs, approveNewAs, NOT_FOUND, rejectAs } from "./resolve";

export type ReviewActionState = { error?: string };

const uuidSchema = z.uuid();

/** Approve an unmatched submission: create a new contact from the payload. */
export async function approveNew(
  _prevState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const claims = await requireUser();

  const id = String(formData.get("id") ?? "");
  if (!uuidSchema.safeParse(id).success) return { error: NOT_FOUND };

  const result = await approveNewAs(claims, id, { source: "owner" });
  if (!result.ok) return { error: result.error };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/review");
  return {};
}

/** Approve a matched submission: merge the payload into the matched contact. */
export async function approveMerge(
  _prevState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const claims = await requireUser();

  const id = String(formData.get("id") ?? "");
  if (!uuidSchema.safeParse(id).success) return { error: NOT_FOUND };

  const result = await approveMergeAs(claims, id, { source: "owner" });
  if (!result.ok) return { error: result.error };

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/contacts/${result.contactId}`);
  revalidatePath("/dashboard/review");
  return {};
}

/** Reject a pending submission. No audit row — nothing changed. */
export async function reject(
  _prevState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const claims = await requireUser();

  const id = String(formData.get("id") ?? "");
  if (!uuidSchema.safeParse(id).success) return { error: NOT_FOUND };

  const result = await rejectAs(claims, id);
  if (!result.ok) return { error: result.error };

  // Else the sheet keeps a stale "Two answers" chip for this reply.
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/review");
  return {};
}
