"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { undoAgentChange } from "@/lib/agent/changes";
import { approveRequest, discardRequest } from "@/lib/agent/requests";
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

export async function approvePendingRequest({
  previewId,
}: {
  previewId: string;
}): Promise<{ error?: string }> {
  const claims = await requireUser();
  if (!uuid.safeParse(previewId).success) return { error: "Request not found." };
  const result = await approveRequest(claims, previewId);
  if (!result.ok) return { error: result.error };
  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
  return {};
}

export async function discardPendingRequest({
  previewId,
}: {
  previewId: string;
}): Promise<{ error?: string }> {
  const claims = await requireUser();
  if (!uuid.safeParse(previewId).success) return { error: "Request not found." };
  const result = await discardRequest(claims, previewId);
  if (!result.ok) return { error: result.error };
  revalidatePath("/dashboard/agents");
  return {};
}
