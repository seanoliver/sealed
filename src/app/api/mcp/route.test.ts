import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { generateAgentToken, mintAgentToken } from "@/lib/agent/tokens";
import { dbAdmin } from "@/lib/db/admin";
import { POST } from "./route";

const U = "00000000-0000-4000-8000-0000000aa001";
const B = "10000000-0000-4000-8000-0000000aa001";
const C = "20000000-0000-4000-8000-0000000aa001";

let readToken: string;
let writeOnlyToken: string;
let nextId = 1;

function rpc(token: string | null, method: string, params: object = {}) {
  return POST(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
}

async function body(response: Response) {
  const text = await response.text();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return JSON.parse(text);
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(data!.slice("data: ".length));
}

describe("/api/mcp", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`delete from public.agent_tokens where user_id = ${U}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'mcp-owner@mcp.test') on conflict (id) do nothing`);
    await dbAdmin.execute(sql`insert into public.books (id, owner_id, slug) values (${B}, ${U}, 'mcp-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, email, city)
      values (${C}, ${B}, 'Ana Reyes', 'ana@mcp.test', 'Springfield')`);
    readToken = (await mintAgentToken(U, { name: "read", scopes: ["read"] })).token;
    writeOnlyToken = (await mintAgentToken(U, { name: "write", scopes: ["write"] })).token;
  });

  afterAll(async () => {
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`delete from auth.users where id = ${U}`);
  });

  it("serves initialize, tools/list and tools/call to a valid token", async () => {
    const init = await rpc(readToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0" },
    });
    expect(init.status).toBe(200);
    expect((await body(init)).result.serverInfo.name).toBe("sealed");

    const list = await body(await rpc(readToken, "tools/list"));
    expect(list.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "address_gaps",
      "book_summary",
      "export_contacts",
      "find_duplicates",
      "get_contact",
      "list_review_queue",
      "search_contacts",
    ]);

    const call = await body(
      await rpc(readToken, "tools/call", { name: "search_contacts", arguments: { query: "spring" } }),
    );
    expect(call.result.isError).toBeFalsy();
    expect(JSON.parse(call.result.content[0].text)).toMatchObject({
      total: 1,
      items: [{ id: C, name: "Ana Reyes", city: "Springfield" }],
    });
  });

  it("answers 401 to a missing, unknown or malformed token", async () => {
    for (const token of [null, generateAgentToken().token, "garbage"]) {
      const response = await rpc(token, "tools/list");
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/^Bearer /);
    }
  });

  it("answers 503, not 401, when the database is down during verification", async () => {
    vi.spyOn(dbAdmin, "execute").mockRejectedValueOnce(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );
    const log = vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const response = await rpc(readToken, "tools/list");
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(log).toHaveBeenCalledWith(
      "[mc] [auth] token verification failed db error",
      JSON.stringify({ code: "ECONNREFUSED" }),
    );
  });

  it("reports an unknown contact as a tool error", async () => {
    const call = await body(
      await rpc(readToken, "tools/call", {
        name: "get_contact",
        arguments: { id: "20000000-0000-4000-8000-0000000aa0ff" },
      }),
    );
    expect(call.result).toMatchObject({ isError: true, content: [{ type: "text", text: "Not found." }] });
  });

  it("hides unexpected failures behind a generic tool error", async () => {
    vi.spyOn(dbAdmin, "transaction").mockRejectedValue(new Error("relation exploded"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const call = await body(
        await rpc(readToken, "tools/call", { name: "book_summary", arguments: {} }),
      );
      expect(call.result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "Something went wrong. Please try again." }],
      });
      expect(JSON.stringify(call)).not.toContain("exploded");
      expect(log).toHaveBeenCalledWith("[mc] [book_summary] db error", expect.any(String));
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("refuses read tools to a token without the read scope", async () => {
    const response = await rpc(writeOnlyToken, "tools/call", {
      name: "book_summary",
      arguments: {},
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toMatch(/insufficient_scope/);
  });
});
