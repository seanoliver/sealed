"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { undoAgentChange } from "@/lib/agent/changes";
import { requireUser } from "@/lib/auth";

export async function undoChange({ eventId }: { eventId: string }): Promise<{ error?: string }> {
  const claims = await requireUser();
  if (!z.uuid().safeParse(eventId).success) return { error: "Change not found." };
  const result = await undoAgentChange(claims, eventId, { source: "owner" });
  if (!result.ok) return { error: result.error };
  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/contacts/${result.value.contactId}`);
  return {};
}
