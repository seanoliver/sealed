import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { verifyAgentToken } from "@/lib/agent/tokens";
import { dbAdmin } from "@/lib/db/admin";
import { createAgentToken, listAgentTokens, revokeAgentToken } from "./agent-token-actions";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const U = "00000000-0000-4000-8000-0000000ab001";
const OTHER = "00000000-0000-4000-8000-0000000ab002";

describe("agent token actions", () => {
  beforeEach(async () => {
    vi.mocked(requireUser).mockResolvedValue({ sub: U });
    await dbAdmin.execute(sql`delete from public.agent_tokens where user_id in (${U}, ${OTHER})`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'ata-owner@ata.test'), (${OTHER}, 'ata-other@ata.test')
      on conflict (id) do nothing`);
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from auth.users where id in (${U}, ${OTHER})`);
  });

  it("creates a token for the signed-in owner and shows it once", async () => {
    const created = await createAgentToken({ name: "Claude Code", scopes: ["read"], expiresInDays: 90 });
    if (!("token" in created)) throw new Error(created.error);
    expect((await verifyAgentToken(created.token))?.claims.sub).toBe(U);

    const listed = await listAgentTokens();
    expect(listed).toEqual([expect.objectContaining({ id: created.summary.id, name: "Claude Code" })]);
    expect(JSON.stringify(listed)).not.toContain(created.token);
  });

  it("mints for the session user even when the caller passes another user id", async () => {
    const created = await createAgentToken({
      name: "sneaky",
      scopes: ["read"],
      userId: OTHER,
    } as never);
    if (!("token" in created)) throw new Error(created.error);
    expect((await verifyAgentToken(created.token))?.claims.sub).toBe(U);
    const [{ n }] = await dbAdmin.execute<{ n: number }>(
      sql`select count(*)::int as n from public.agent_tokens where user_id = ${OTHER}`,
    );
    expect(n).toBe(0);
  });

  it("returns a generic message when the insert fails", async () => {
    const insert = vi.spyOn(dbAdmin, "insert").mockImplementationOnce(() => {
      throw new Error("connection lost");
    });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect(await createAgentToken({ name: "x", scopes: ["read"] })).toEqual({
      error: "Something went wrong. Please try again.",
    });
    expect(insert).toHaveBeenCalledOnce();
  });

  it("explains invalid input", async () => {
    expect(await createAgentToken({ name: "x", scopes: [] })).toEqual({
      error: "Pick at least one scope",
    });
  });

  it("revokes a token once", async () => {
    const created = await createAgentToken({ name: "temp", scopes: ["read"] });
    if (!("token" in created)) throw new Error(created.error);
    expect(await revokeAgentToken({ id: created.summary.id })).toEqual({});
    expect(await revokeAgentToken({ id: created.summary.id })).toEqual({
      error: "Token not found or already revoked",
    });
    expect(await revokeAgentToken({ id: "not-a-uuid" })).toEqual({ error: "Token not found" });
    expect(await verifyAgentToken(created.token)).toBeNull();
  });
});
