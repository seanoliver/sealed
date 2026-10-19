import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type SessionClaims } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { dbAdmin } from "@/lib/db/admin";
import { agentTokens } from "@/lib/db/schema";
import { AGENT_SCOPES, type AgentScope } from "./scopes";

export const AGENT_TOKEN_PREFIX = "sealed_pat_";

// {43} is the base64url length of generateAgentToken's 32 random bytes; change both together.
export const AGENT_TOKEN_SHAPE = /^sealed_pat_[A-Za-z0-9_-]{43}$/;

export function hashAgentToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function generateAgentToken(): { token: string; hash: Buffer } {
  const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashAgentToken(token) };
}

export const MAX_TOKEN_DAYS = 365;

export const agentTokenInputSchema = z.object({
  name: z.string().trim().min(1, "Name the token").max(100),
  scopes: z
    .array(z.enum(AGENT_SCOPES))
    .min(1, "Pick at least one scope")
    .transform((scopes) => AGENT_SCOPES.filter((scope) => scopes.includes(scope))),
  expiresInDays: z.int().min(1).max(MAX_TOKEN_DAYS).optional(),
});

export type AgentTokenInput = z.input<typeof agentTokenInputSchema>;

export type AgentTokenSummary = {
  id: string;
  name: string;
  scopes: AgentScope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

const summaryColumns = {
  id: agentTokens.id,
  name: agentTokens.name,
  scopes: agentTokens.scopes,
  createdAt: agentTokens.createdAt,
  lastUsedAt: agentTokens.lastUsedAt,
  expiresAt: agentTokens.expiresAt,
  revokedAt: agentTokens.revokedAt,
};

// Bypasses RLS: `userId` must come from an authenticated session, never from request input.
export async function mintAgentToken({
  userId,
  ...input
}: { userId: string } & AgentTokenInput): Promise<{ token: string; summary: AgentTokenSummary }> {
  const { name, scopes, expiresInDays } = agentTokenInputSchema.parse(input);
  const { token, hash } = generateAgentToken();
  const [summary] = await dbAdmin
    .insert(agentTokens)
    .values({
      userId,
      name,
      scopes,
      tokenHash: hash,
      expiresAt:
        expiresInDays === undefined
          ? null
          : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
    })
    .returning(summaryColumns);
  return { token, summary };
}

export async function listAgentTokens(claims: SessionClaims): Promise<AgentTokenSummary[]> {
  return withRls(claims, (tx) =>
    tx
      .select(summaryColumns)
      .from(agentTokens)
      .where(eq(agentTokens.userId, claims.sub))
      .orderBy(desc(agentTokens.createdAt), desc(agentTokens.id)),
  );
}

// Validate `id` as a UUID first: any other string makes Postgres throw instead of returning false.
export async function revokeAgentToken(claims: SessionClaims, id: string): Promise<boolean> {
  const rows = await withRls(claims, (tx) =>
    tx
      .update(agentTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(agentTokens.id, id), isNull(agentTokens.revokedAt)))
      .returning({ id: agentTokens.id }),
  );
  return rows.length > 0;
}

export type AgentPrincipal = {
  tokenId: string;
  scopes: AgentScope[];
  expiresAt: Date | null;
  claims: SessionClaims;
};

type VerifiedRow = {
  token_id: string;
  user_id: string;
  scopes: AgentScope[];
  expires_at: Date | string | null;
  [k: string]: unknown;
};

export async function verifyAgentToken(token: string | undefined): Promise<AgentPrincipal | null> {
  if (token === undefined || !AGENT_TOKEN_SHAPE.test(token)) return null;
  const [row] = await dbAdmin.execute<VerifiedRow>(
    sql`select * from private.verify_agent_token(${hashAgentToken(token)})`,
  );
  if (!row) return null;
  return {
    tokenId: row.token_id,
    scopes: row.scopes,
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
    claims: { sub: row.user_id, agent_token_id: row.token_id },
  };
}
