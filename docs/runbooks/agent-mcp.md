# Connect an agent to the MCP server

- **Status:** Current
- **Last verified:** branch `feat/agent-mcp-write` on 2026-10-19 in local development
- **Owner:** Sean
- **Related:** Issue #109 (MCP server and API for agents to manage the address book)

## Purpose

Give an agent such as Claude Code access to an address book through the remote MCP server at `/api/mcp`. The agent authenticates with a personal access token, and every tool call runs through `withRls` as the token's owner.

## Prerequisites

- The owner's account email.
- A shell in the repository with `pnpm install` done.
- `DATABASE_URL` for the target database. `pnpm agent:token` loads `.env.local`, which targets the local Supabase database. Node's `--env-file` never overrides a variable already set, so prefix the command with `DATABASE_URL=...` to mint for production.
- Migrations `20261021120000_agent_tokens.sql` and `20261023120000_agent_changes.sql` applied to that database.

## Procedure

1. Create a token on the **Agents** page (`/dashboard/agents`): tick what the agent may do (**Look things up** is `read`, **Fix and fill in** is `write`; **Email people** is disabled until send tools exist), name it, pick an expiry (30, 90 or 365 days, default 90) and press **Create token**. The page shows the token (`sealed_pat_…`) inside a ready-to-paste `claude mcp add` command once; only its sha256 is stored.

   Without the dashboard (for example against production from a shell), the script calls the same `mintAgentToken`:

   ```bash
   pnpm agent:token --email you@example.com --name "Claude Code" \
     --scopes read,write --expires-days 90
   ```

   `DATABASE_URL` comes from `.env.local`; prefix the command with `DATABASE_URL=...` to mint for another database.

2. Add the server to Claude Code:

   ```bash
   claude mcp add --transport http sealed https://sealed.page/api/mcp \
     --header "Authorization: Bearer <token>"
   ```

   For local development use `http://localhost:3000/api/mcp`.

## Verification

- In Claude Code, `/mcp` lists `sealed` as connected with twelve tools (the list does not depend on scopes; calling a tool outside the token's scopes answers 403):
  - `read`: `search_contacts`, `get_contact`, `book_summary`, `address_gaps`, `find_duplicates`, `list_review_queue`, `export_contacts`.
  - `write`: `update_contact`, `create_contact`, `undo_agent_change`, `preview_delete_contacts`, `request_delete_contacts`.
- An edit made by the agent appears under **Recent agent changes** on the Agents page and as "Agent: <token name>" in the contact's history.
- Ask for a book summary; the counts match the dashboard.
- `agent_tokens.last_used_at` for the token is set (it updates at most once a minute).
- A request without the header gets `401` with a `WWW-Authenticate: Bearer` challenge:

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://sealed.page/api/mcp \
    -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```

## How writes work

- `update_contact` and `create_contact` save at once, with the dashboard's validation (they call the same `patchContactAs` and `createContactAs`), and return an `event_id`. Agents can read the review queue but not resolve it.
- Each agent write records a `contact_events` row (`source = 'agent'`, the token id, the contact's `updated_at` after the write) in the same transaction as the write: an RLS insert policy lets the owner's session add only agent rows for their own live token. If the history can't be written, nothing is saved.
- Two kinds of change wait for the owner under **Waiting for you** on the Agents page, for 7 days:
  - An `update_contact` that changes an existing contact's `email` or `partner_email` saves the other fields and queues the email change; the result carries `pending_email_change`. `create_contact` sets emails directly.
  - `preview_delete_contacts({ids})` lists what would go, and `request_delete_contacts({preview_id})` hands it to the owner. No tool deletes, and none is marked destructive.
- **Approve** (after a confirm) runs in one transaction: it locks the request, checks it is still open and unexpired, locks the contacts and refuses, by name, if any changed since the agent asked, writes the change and its history, and marks the request applied. **Discard** keeps everything. Revoking a token discards its open requests.
- `undo_agent_change({event_id})`, and **Undo** on the Agents page, put the replaced values back unless the contact changed since. Changes that added a contact can't be undone, deletes can't be undone at all, and only the owner can undo an email change.
- Requests hold contact details until they are approved or discarded; then only names (and the contact id for email changes) stay. Requests are pruned on each Agents page load and each new delete preview: unfinished ones once expired, finished ones 30 days after they finished. The change history stays.
- No tool sends email or touches recipient links (`update_tokens`).

## Failure recovery

- **401 with a token:** the token is malformed, unknown, revoked or expired, or was minted against a different database. Mint a new one.
- **503 with `Retry-After`:** the database could not be reached while checking the token. The token is probably fine; retry later and check the logs for `[mc] [auth] token verification failed`. Do not mint a new token.
- **403 `insufficient_scope`:** the token lacks the tool's scope. Create a token with the scope; scopes cannot be edited.
- **Approval refused because a contact changed:** someone edited the contact after the agent asked. Discard the request and ask the agent for a new one.
- **"This contact changed since you opened it" on the contact page:** an agent (or another tab) saved the contact after the page loaded. Reload and edit again.
- **Leaked token:** press **Revoke** next to it on the Agents page. Without the dashboard, run against the same database:

  ```sql
  update public.agent_tokens set revoked_at = now() where id = '<token id>' and revoked_at is null;
  ```

## References

- `src/app/api/mcp/route.ts`: the route, using `createMcpHandler` and `withMcpAuth` from `mcp-handler` 2.2.0.
- `src/lib/agent/`: tokens and verifier (`tokens.ts`), scopes (`scopes.ts`), read tools (`read.ts`), write tool inputs (`write.ts`), delete and email requests (`requests.ts`), change feed and undo (`changes.ts`), MCP registration with `registerReadTool`/`registerWriteTool` (`mcp.ts`).
- `src/app/dashboard/contacts/write.ts`: contact writes shared by the dashboard and the agent.
- `src/app/dashboard/agents/`: the Agents page. `src/app/dashboard/settings/agent-token-actions.ts`: create, list and revoke server actions.
- `supabase/migrations/20261021120000_agent_tokens.sql`: table, RLS, column grants, `private.verify_agent_token`.
- `supabase/migrations/20261023120000_agent_changes.sql`: `agent_previews` (delete and email requests), the `agent` source and columns on `contact_events`, and the RLS policies that let agent history and email requests be written in the owner's transaction.
- `node_modules/mcp-handler/README.md`: protocol support and auth wrapper.
