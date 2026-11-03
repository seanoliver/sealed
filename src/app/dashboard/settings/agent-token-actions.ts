"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  agentTokenInputSchema,
  listAgentTokens as listOwnTokens,
  mintAgentToken,
  revokeAgentToken as revokeOwnToken,
  type AgentTokenInput,
  type AgentTokenSummary,
} from "@/lib/agent/tokens";
import { logDbError } from "@/lib/log";
import { getOwnBook } from "@/lib/queries/books";

export type CreateAgentTokenResult =
  | { token: string; summary: AgentTokenSummary }
  | { error: string };

export async function createAgentToken(input: AgentTokenInput): Promise<CreateAgentTokenResult> {
  const claims = await requireUser();
  const parsed = agentTokenInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  // A member's agent writes would always fail RLS (contact_events_insert_agent).
  const book = await getOwnBook(claims);
  if (book && book.ownerId !== claims.sub) {
    return { error: "Only the address book's owner can connect agents." };
  }
  try {
    const created = await mintAgentToken(claims.sub, parsed.data);
    revalidatePath("/dashboard/agents");
    return created;
  } catch (err) {
    logDbError("[at] [createAgentToken] insert failed", err);
    return { error: "Something went wrong. Please try again." };
  }
}

export async function listAgentTokens(): Promise<AgentTokenSummary[]> {
  return listOwnTokens(await requireUser());
}

export async function revokeAgentToken({ id }: { id: string }): Promise<{ error?: string }> {
  const claims = await requireUser();
  if (!z.uuid().safeParse(id).success) return { error: "Token not found" };
  if (!(await revokeOwnToken(claims, id))) return { error: "Token not found or already revoked" };
  revalidatePath("/dashboard/agents");
  return {};
}
