"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approveDeletion, discardDeletion } from "@/lib/agent/bulk";
import { undoAgentBatch, undoAgentChange } from "@/lib/agent/changes";
import { requireUser } from "@/lib/auth";

const uuid = z.uuid();

export async function undoChange({ eventId }: { eventId: string }): Promise<{ error?: string }> {
  const claims = await requireUser();
  if (!uuid.safeParse(eventId).success) return { error: "Change not found." };
  const result = await undoAgentChange(claims, eventId, { source: "owner" });
  if (!result.ok) return { error: result.error };
  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/contacts/${result.value.contactId}`);
  return {};
}

export async function undoBulk({
  previewId,
}: {
  previewId: string;
}): Promise<{ error?: string; undone?: number; skipped?: number }> {
  const claims = await requireUser();
  if (!uuid.safeParse(previewId).success) return { error: "Change not found." };
  const result = await undoAgentBatch(claims, previewId, { source: "owner" });
  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
  return result;
}

export async function approvePendingDeletion({
  previewId,
}: {
  previewId: string;
}): Promise<{ error?: string }> {
  const claims = await requireUser();
  if (!uuid.safeParse(previewId).success) return { error: "Request not found." };
  const result = await approveDeletion(claims, previewId);
  if (!result.ok) return { error: result.error };
  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
  return {};
}

export async function discardPendingDeletion({
  previewId,
}: {
  previewId: string;
}): Promise<{ error?: string }> {
  const claims = await requireUser();
  if (!uuid.safeParse(previewId).success) return { error: "Request not found." };
  const result = await discardDeletion(claims, previewId);
  if (!result.ok) return { error: result.error };
  revalidatePath("/dashboard/agents");
  return {};
}
