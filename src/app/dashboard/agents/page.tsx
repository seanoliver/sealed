import { listAgentChanges, type FeedEntry } from "@/lib/agent/changes";
import { listPendingRequests, pruneFinishedRequests } from "@/lib/agent/requests";
import { listAgentTokens } from "@/lib/agent/tokens";
import { requireUser, type SessionClaims } from "@/lib/auth";
import { AgentsView, type FeedItem, type PendingItem, type TokenItem } from "./agents-view";

export const metadata = { title: "Agents" };

function timeFrom(date: Date, now: number): string {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return seconds <= 0 ? "just now" : "in a moment";
  const amount =
    abs < 3600
      ? `${Math.round(abs / 60)} min`
      : abs < 86400
        ? `${Math.round(abs / 3600)} hr`
        : `${Math.round(abs / 86400)} ${Math.round(abs / 86400) === 1 ? "day" : "days"}`;
  return seconds < 0 ? `${amount} ago` : `in ${amount}`;
}

function toFeedItem(entry: FeedEntry, now: number): FeedItem {
  const when = timeFrom(entry.at, now);
  const tokenName = entry.tokenName ?? "Removed token";
  if (entry.kind === "change") {
    return {
      kind: "change",
      key: entry.eventId,
      tokenName,
      when,
      change: { ...entry, when },
    };
  }
  return { kind: "deleted", key: entry.previewId, tokenName, when, names: entry.names };
}

const EMAIL_LABELS = { email: "Email", partner_email: "Partner email" } as const;

async function loadView(claims: SessionClaims) {
  await pruneFinishedRequests(claims.sub);
  const [tokens, feed, pending] = await Promise.all([
    listAgentTokens(claims),
    listAgentChanges(claims),
    listPendingRequests(claims),
  ]);
  const now = Date.now();
  const tokenItems: TokenItem[] = tokens
    .filter((token) => token.revokedAt === null)
    .map((token) => ({
      id: token.id,
      name: token.name,
      scopes: token.scopes,
      lastUsed: token.lastUsedAt ? `used ${timeFrom(token.lastUsedAt, now)}` : "never used",
      expiry:
        token.expiresAt === null
          ? "never expires"
          : token.expiresAt.getTime() <= now
            ? "expired"
            : `expires ${timeFrom(token.expiresAt, now)}`,
    }));
  const pendingItems: PendingItem[] = pending.map((request) => {
    const base = {
      previewId: request.previewId,
      tokenName: request.tokenName ?? "Removed token",
      when: timeFrom(request.requestedAt, now),
      expires: timeFrom(request.expiresAt, now),
    };
    if (request.kind === "email") {
      return {
        ...base,
        kind: "email",
        contactName: request.contactName,
        changes: Object.entries(request.changes).map(([field, [from, to]]) => ({
          label: EMAIL_LABELS[field as keyof typeof EMAIL_LABELS],
          from,
          to,
        })),
      };
    }
    return {
      ...base,
      kind: "delete",
      contacts: request.contacts.map(({ agentEdit, ...contact }) => ({
        ...contact,
        agentEdit: agentEdit
          ? `Edited by this agent ${timeFrom(agentEdit.at, now)}: ${agentEdit.summary}`
          : null,
      })),
    };
  });
  return {
    tokens: tokenItems,
    feed: feed.map((entry) => toFeedItem(entry, now)),
    pending: pendingItems,
  };
}

export default async function AgentsPage() {
  const { tokens, feed, pending } = await loadView(await requireUser());
  return (
    <AgentsView
      mcpUrl={`${process.env.APP_URL}/api/mcp`}
      tokens={tokens}
      feed={feed}
      pending={pending}
    />
  );
}
