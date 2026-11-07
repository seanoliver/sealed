"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { dismissDuplicateAs } from "@/lib/queries/duplicates";
import { mergeDuplicateAs } from "./duplicates";
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

  const result = await approveNewAs(claims, id);
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

  const compared = String(formData.get("contact_id") ?? "");
  const contactId = uuidSchema.safeParse(compared).success ? compared : undefined;

  const result = await approveMergeAs(claims, id, { contactId });
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

const CONTACT_NOT_FOUND = "Contact not found.";

export async function keepDuplicate(
  _prevState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const claims = await requireUser();

  const keepId = String(formData.get("keep_id") ?? "");
  const removeId = String(formData.get("remove_id") ?? "");
  if (!uuidSchema.safeParse(keepId).success || !uuidSchema.safeParse(removeId).success) {
    return { error: CONTACT_NOT_FOUND };
  }

  const result = await mergeDuplicateAs(claims, {
    keepId,
    removeId,
    keepVersion: String(formData.get("keep_version") ?? ""),
    removeVersion: String(formData.get("remove_version") ?? ""),
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/contacts/${keepId}`);
  revalidatePath("/dashboard/review");
  return {};
}

export async function dismissDuplicate(
  _prevState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const claims = await requireUser();

  const firstId = String(formData.get("first_id") ?? "");
  const secondId = String(formData.get("second_id") ?? "");
  if (!uuidSchema.safeParse(firstId).success || !uuidSchema.safeParse(secondId).success) {
    return { error: CONTACT_NOT_FOUND };
  }

  const result = await dismissDuplicateAs(claims, firstId, secondId);
  if (!result.ok) return { error: result.error };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/review");
  return {};
}
