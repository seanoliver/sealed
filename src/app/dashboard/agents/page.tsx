import { listAgentChanges, type FeedEntry } from "@/lib/agent/changes";
import { listAgentTokens } from "@/lib/agent/tokens";
import { requireUser, type SessionClaims } from "@/lib/auth";
import { AgentsView, type FeedItem, type TokenItem } from "./agents-view";

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
  if (entry.kind === "bulk") {
    return {
      kind: "bulk",
      key: entry.previewId,
      tokenName,
      when,
      changes: entry.changes.map((change) => ({ ...change, when: timeFrom(change.at, now) })),
    };
  }
  return { kind: "deleted", key: entry.previewId, tokenName, when, names: entry.names };
}

async function loadView(claims: SessionClaims) {
  const [tokens, feed] = await Promise.all([listAgentTokens(claims), listAgentChanges(claims)]);
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
  return { tokens: tokenItems, feed: feed.map((entry) => toFeedItem(entry, now)) };
}

export default async function AgentsPage() {
  const { tokens, feed } = await loadView(await requireUser());
  return <AgentsView mcpUrl={`${process.env.APP_URL}/api/mcp`} tokens={tokens} feed={feed} />;
}
