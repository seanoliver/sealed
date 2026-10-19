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

export type CreateAgentTokenResult =
  | { token: string; summary: AgentTokenSummary }
  | { error: string };

/** The plaintext token is in this response only; it cannot be shown again. */
export async function createAgentToken(input: AgentTokenInput): Promise<CreateAgentTokenResult> {
  const claims = await requireUser();
  const parsed = agentTokenInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    const created = await mintAgentToken({ userId: claims.sub, ...input });
    revalidatePath("/dashboard/settings");
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
  revalidatePath("/dashboard/settings");
  return {};
}
