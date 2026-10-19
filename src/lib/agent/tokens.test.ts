import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import { agentTokens } from "@/lib/db/schema";
import {
  AGENT_TOKEN_SHAPE,
  generateAgentToken,
  listAgentTokens,
  mintAgentToken,
  revokeAgentToken,
  verifyAgentToken,
} from "./tokens";

const U = "00000000-0000-4000-8000-0000000a8001";
const OTHER = "00000000-0000-4000-8000-0000000a8002";

const stored = async (id: string) =>
  (await dbAdmin.select().from(agentTokens).where(eq(agentTokens.id, id)))[0];

describe("agent tokens", () => {
  beforeEach(async () => {
    await dbAdmin.execute(sql`delete from public.agent_tokens where user_id in (${U}, ${OTHER})`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'at-owner@vt.test'), (${OTHER}, 'at-other@vt.test')
      on conflict (id) do nothing`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from auth.users where id in (${U}, ${OTHER})`);
  });

  it("generates prefixed tokens and stores only their hash", async () => {
    expect(generateAgentToken().token).toMatch(AGENT_TOKEN_SHAPE);

    const { token, summary } = await mintAgentToken({
      userId: U,
      name: " Claude Code ",
      scopes: ["write", "read", "read"],
    });
    expect(token).toMatch(AGENT_TOKEN_SHAPE);
    expect(summary).toMatchObject({ name: "Claude Code", scopes: ["read", "write"], expiresAt: null });
    expect(summary).not.toHaveProperty("tokenHash");

    const row = await stored(summary.id);
    expect(row.tokenHash.toString("hex")).not.toContain(Buffer.from(token).toString("hex"));
    expect(row.tokenHash).toHaveLength(32);
  });

  it("rejects bad input before touching the database", async () => {
    await expect(mintAgentToken({ userId: U, name: "", scopes: ["read"] })).rejects.toThrow();
    await expect(mintAgentToken({ userId: U, name: "x", scopes: [] })).rejects.toThrow();
    await expect(
      mintAgentToken({ userId: U, name: "x", scopes: ["read"], expiresInDays: 0 }),
    ).rejects.toThrow();
  });

  it("verifies a live token to its owner's claims", async () => {
    const { token, summary } = await mintAgentToken({
      userId: U,
      name: "agent",
      scopes: ["read"],
      expiresInDays: 30,
    });

    const principal = await verifyAgentToken(token);
    expect(principal).toMatchObject({
      tokenId: summary.id,
      scopes: ["read"],
      claims: { sub: U, agent_token_id: summary.id },
    });
    expect(principal?.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await stored(summary.id)).lastUsedAt).not.toBeNull();
  });

  it("records last use at most once a minute", async () => {
    const { token, summary } = await mintAgentToken({ userId: U, name: "agent", scopes: ["read"] });
    await dbAdmin.execute(sql`
      update public.agent_tokens set last_used_at = now() - interval '30 seconds' where id = ${summary.id}`);
    const before = (await stored(summary.id)).lastUsedAt;
    await verifyAgentToken(token);
    expect((await stored(summary.id)).lastUsedAt).toEqual(before);

    await dbAdmin.execute(sql`
      update public.agent_tokens set last_used_at = now() - interval '2 minutes' where id = ${summary.id}`);
    await verifyAgentToken(token);
    expect((await stored(summary.id)).lastUsedAt!.getTime()).toBeGreaterThan(Date.now() - 10_000);
  });

  it("refuses malformed, unknown, revoked and expired tokens", async () => {
    const { token, summary } = await mintAgentToken({ userId: U, name: "agent", scopes: ["read"] });

    expect(await verifyAgentToken(undefined)).toBeNull();
    expect(await verifyAgentToken("not-a-token")).toBeNull();
    expect(await verifyAgentToken(generateAgentToken().token)).toBeNull();

    await dbAdmin.execute(sql`
      update public.agent_tokens
      set created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
      where id = ${summary.id}`);
    expect(await verifyAgentToken(token)).toBeNull();

    await dbAdmin.execute(sql`
      update public.agent_tokens set expires_at = null, revoked_at = now() where id = ${summary.id}`);
    expect(await verifyAgentToken(token)).toBeNull();
  });

  it("lists and revokes only the owner's tokens", async () => {
    const mine = await mintAgentToken({ userId: U, name: "mine", scopes: ["read"] });
    const theirs = await mintAgentToken({ userId: OTHER, name: "theirs", scopes: ["read"] });

    const listed = await listAgentTokens({ sub: U });
    expect(listed.map((token) => token.name)).toEqual(["mine"]);
    expect(listed[0]).not.toHaveProperty("tokenHash");

    expect(await revokeAgentToken({ sub: U }, theirs.summary.id)).toBe(false);
    expect((await stored(theirs.summary.id)).revokedAt).toBeNull();

    expect(await revokeAgentToken({ sub: U }, mine.summary.id)).toBe(true);
    expect(await revokeAgentToken({ sub: U }, mine.summary.id)).toBe(false);
    expect(await verifyAgentToken(mine.token)).toBeNull();
    expect(await verifyAgentToken(theirs.token)).not.toBeNull();
  });
});
