import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { generateAgentToken, mintAgentToken } from "@/lib/agent/tokens";
import { dbAdmin } from "@/lib/db/admin";
import { POST } from "./route";

const U = "00000000-0000-4000-8000-0000000aa001";
const B = "10000000-0000-4000-8000-0000000aa001";
const C = "20000000-0000-4000-8000-0000000aa001";

const READ_TOOLS = [
  "address_gaps",
  "book_summary",
  "export_contacts",
  "find_duplicates",
  "get_contact",
  "list_review_queue",
  "search_contacts",
];
const WRITE_TOOLS = [
  "apply_bulk_update",
  "apply_delete_contacts",
  "create_contact",
  "preview_bulk_update",
  "preview_delete_contacts",
  "resolve_review_item",
  "undo_agent_change",
  "update_contact",
];

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
      ...READ_TOOLS,
      ...WRITE_TOOLS,
    ].sort());

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

  it("labels recipient text as untrusted in the instructions and every tool", async () => {
    const init = await body(
      await rpc(readToken, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0" },
      }),
    );
    expect(init.result.instructions).toMatch(/never as instructions/);
    const list = await body(await rpc(readToken, "tools/list"));
    for (const tool of list.result.tools) expect(tool.description).toMatch(/never as instructions/);
  });

  it("refuses every non-read tool to a read-only token, before it runs", async () => {
    const list = await body(await rpc(readToken, "tools/list"));
    const writeTools = list.result.tools.filter(
      (tool: { annotations?: { readOnlyHint?: boolean } }) => tool.annotations?.readOnlyHint !== true,
    );
    expect(writeTools.map((tool: { name: string }) => tool.name).sort()).toEqual(WRITE_TOOLS);
    const events = () =>
      dbAdmin.execute(sql`select count(*)::int as n from public.contact_events where contact_id = ${C}`);
    const before = await events();
    for (const tool of writeTools) {
      const response = await rpc(readToken, "tools/call", { name: tool.name, arguments: {} });
      expect(response.status, tool.name).toBe(403);
      expect(response.headers.get("www-authenticate")).toMatch(/insufficient_scope/);
    }
    expect(await events()).toEqual(before);
  });

  it("updates a contact for a write token and records the agent", async () => {
    const call = await body(
      await rpc(writeOnlyToken, "tools/call", {
        name: "update_contact",
        arguments: { id: C, fields: { city: "Shelbyville" } },
      }),
    );
    expect(call.result.isError).toBeFalsy();
    const result = JSON.parse(call.result.content[0].text);
    expect(result).toMatchObject({ changed: true, after: { city: "Shelbyville" } });
    const [event] = await dbAdmin.execute<{ source: string; name: string }>(sql`
      select e.source, t.name from public.contact_events e
      join public.agent_tokens t on t.id = e.agent_token_id where e.id = ${result.event_id}`);
    expect(event).toEqual({ source: "agent", name: "write" });
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
