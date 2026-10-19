# Connect an agent to the MCP server

- **Status:** Current
- **Last verified:** branch `feat/agent-mcp-read` on 2026-10-19 in local development
- **Owner:** Sean
- **Related:** Issue #109 (MCP server and API for agents to manage the address book)

## Purpose

Give an agent such as Claude Code read access to an address book through the remote MCP server at `/api/mcp`. The agent authenticates with a personal access token, and every tool call reads through `withRls` as the token's owner.

## Prerequisites

- The owner's account email.
- A shell in the repository with `pnpm install` done.
- An env file whose `DATABASE_URL` points at the target database. `.env.local` targets the local Supabase database; minting for production needs the production `DATABASE_URL`.
- Migration `20261021120000_agent_tokens.sql` applied to that database.

## Procedure

1. Mint a token. Settings will do this later; until then use the script, which calls the same `mintAgentToken` as the server action:

   ```bash
   pnpm exec tsx --conditions=react-server --env-file=.env.local \
     scripts/create-agent-token.ts --email you@example.com --name "Claude Code" \
     --scopes read --expires-days 90
   ```

   `--scopes` takes a comma-separated subset of `read,write,send` (only `read` tools exist today). Omit `--expires-days` for a token that never expires. The token (`sealed_pat_…`) prints once; only its sha256 is stored.

2. Add the server to Claude Code:

   ```bash
   claude mcp add --transport http sealed https://sealed.page/api/mcp \
     --header "Authorization: Bearer <token>"
   ```

   For local development use `http://localhost:3000/api/mcp`.

## Verification

- In Claude Code, `/mcp` lists `sealed` as connected with seven tools: `search_contacts`, `get_contact`, `book_summary`, `address_gaps`, `find_duplicates`, `list_review_queue`, `export_contacts`.
- Ask for a book summary; the counts match the dashboard.
- `agent_tokens.last_used_at` for the token is set (it updates at most once a minute).
- A request without the header gets `401` with a `WWW-Authenticate: Bearer` challenge:

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://sealed.page/api/mcp \
    -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```

## Failure recovery

- **401 with a token:** the token is malformed, revoked, expired, or minted against a different database. Mint a new one.
- **403 `insufficient_scope`:** the token lacks the tool's scope. Mint a token with the scope; scopes cannot be edited.
- **Leaked token:** revoke it. Until Settings has a button, run against the same database:

  ```sql
  update public.agent_tokens set revoked_at = now() where id = '<token id>' and revoked_at is null;
  ```

  The `revokeAgentToken` server action does the same as the owner.

## References

- `src/app/api/mcp/route.ts`: the route, using `createMcpHandler` and `withMcpAuth` from `mcp-handler` 2.2.0.
- `src/lib/agent/`: tokens and verifier (`tokens.ts`), scopes (`scopes.ts`), read tools (`read.ts`), MCP registration (`mcp.ts`).
- `src/app/dashboard/settings/agent-token-actions.ts`: create, list and revoke server actions.
- `supabase/migrations/20261021120000_agent_tokens.sql`: table, RLS, column grants, `private.verify_agent_token`.
- `node_modules/mcp-handler/README.md`: protocol support and auth wrapper.
