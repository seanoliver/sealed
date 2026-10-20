"use client";

import { useState, useTransition } from "react";
import { type UndoState } from "@/lib/agent/changes";
import { type AgentScope } from "@/lib/agent/scopes";
import { cn } from "@/lib/utils";
import { createAgentToken, revokeAgentToken } from "../settings/agent-token-actions";
import { undoChange } from "./actions";

export type ChangeItem = {
  eventId: string;
  contactName: string;
  summary: string;
  when: string;
  undo: UndoState;
};

export type FeedItem =
  | { kind: "change"; key: string; tokenName: string; when: string; change: ChangeItem }
  | { kind: "bulk"; key: string; tokenName: string; when: string; changes: ChangeItem[] }
  | { kind: "deleted"; key: string; tokenName: string; when: string; names: string[] };

export type TokenItem = {
  id: string;
  name: string;
  scopes: AgentScope[];
  lastUsed: string;
  expiry: string;
};

const cardClasses = "rounded-xl border border-border bg-card p-6 shadow-sm";
const inputClasses =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/25";
const primaryButton =
  "inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-50";
const outlineButton =
  "inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:px-3 sm:text-[13px]";
const alertClasses =
  "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200";

const SCOPE_LABELS: Record<AgentScope, string> = {
  read: "Look up",
  write: "Fix and fill in",
  send: "Email people",
};

const EXPIRY_OPTIONS = [
  { days: 30, label: "In 30 days" },
  { days: 90, label: "In 90 days" },
  { days: 365, label: "In a year" },
];

export function AgentsView({
  mcpUrl,
  tokens,
  feed,
}: {
  mcpUrl: string;
  tokens: TokenItem[];
  feed: FeedItem[];
}) {
  const [tab, setTab] = useState<"changes" | "connect">("changes");
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:py-8">
      <h1 className="font-serif text-2xl leading-tight text-foreground lg:sr-only">Agents</h1>
      <div
        role="tablist"
        aria-label="Agents"
        className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-border text-sm font-semibold lg:hidden"
      >
        {(
          [
            ["changes", "Recent changes"],
            ["connect", "Connect"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "h-11 transition-colors",
              tab === value ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-7 lg:mt-0 lg:grid-cols-2">
        <div className={cn(tab === "connect" ? "block" : "hidden", "lg:block")}>
          <ConnectPanel mcpUrl={mcpUrl} tokens={tokens} />
        </div>
        <div className={cn(tab === "changes" ? "block" : "hidden", "lg:block")}>
          <ChangesPanel feed={feed} />
        </div>
      </div>
    </main>
  );
}

function ConnectPanel({ mcpUrl, tokens }: { mcpUrl: string; tokens: TokenItem[] }) {
  const [scopes, setScopes] = useState<Record<"read" | "write", boolean>>({ read: true, write: true });
  const [name, setName] = useState("Claude Code");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const command = created
    ? `claude mcp add --transport http sealed ${mcpUrl} --header "Authorization: Bearer ${created.token}"`
    : null;

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createAgentToken({
        name,
        scopes: (["read", "write"] as const).filter((scope) => scopes[scope]),
        expiresInDays,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setCopied(false);
      setCreated({ token: result.token, name: result.summary.name });
    });
  }

  async function copy() {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the command and copy it by hand.");
    }
  }

  return (
    <section aria-labelledby="connect-heading" className={cn(cardClasses, "flex flex-col gap-4")}>
      <h2 id="connect-heading" className="font-serif text-2xl leading-tight text-foreground">
        Connect an agent
      </h2>
      <ol className="flex flex-col gap-4">
        <li className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">1 · What can it do?</h3>
          <ScopeOption
            checked={scopes.read}
            onChange={(read) => setScopes((current) => ({ ...current, read }))}
            title="Look things up."
            body="Search contacts, find gaps and duplicates, export."
          />
          <ScopeOption
            checked={scopes.write}
            onChange={(write) => setScopes((current) => ({ ...current, write }))}
            title="Fix and fill in."
            body="Edit, add and delete contacts, and work the review queue. Bulk changes always show you a preview first."
          />
          <ScopeOption
            checked={false}
            disabled
            title="Email people."
            body="Send address requests to real recipients."
            badge="Coming soon"
          />
        </li>
        <li className="flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1.5 text-sm">
            <span className="font-semibold text-foreground">2 · Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              className={inputClasses}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm sm:w-40">
            <span className="font-semibold text-foreground">Expires</span>
            <select
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(Number(event.target.value))}
              className={inputClasses}
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.days} value={option.days}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </li>
        <li className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">3 · Paste this into your terminal</h3>
          {command ? (
            <>
              <code
                data-testid="mcp-command"
                className="rounded-lg border border-border bg-secondary/60 p-3 font-mono text-xs break-all whitespace-pre-wrap text-foreground"
              >
                {command}
              </code>
              <p className="text-xs text-muted-foreground">
                This is the only time the token is shown. If you lose it, revoke it and make another.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copy} className={primaryButton}>
                  {copied ? "Copied" : "Copy command"}
                </button>
                <button type="button" onClick={() => setCreated(null)} className={cn(outlineButton, "sm:h-10 sm:px-3.5 sm:text-sm")}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Creating the token shows a command with it, once.
              </p>
              <button
                type="button"
                onClick={create}
                disabled={pending || (!scopes.read && !scopes.write) || name.trim() === ""}
                className={cn(primaryButton, "self-start")}
              >
                {pending ? "Creating…" : "Create token"}
              </button>
            </>
          )}
          {error ? (
            <p role="alert" className={alertClasses}>
              {error}
            </p>
          ) : null}
        </li>
      </ol>
      <TokenList tokens={tokens} />
    </section>
  );
}

function ScopeOption({
  checked,
  onChange,
  title,
  body,
  disabled = false,
  badge,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  title: string;
  body: string;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors",
        checked ? "border-primary ring-1 ring-primary" : "border-border",
        disabled ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer text-foreground",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        className="mt-0.5 size-4 accent-primary"
      />
      <span className="flex-1">
        <strong className="font-semibold">{title}</strong> {body}
      </span>
      {badge ? (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-muted-foreground">
          {badge}
        </span>
      ) : null}
    </label>
  );
}

function TokenList({ tokens }: { tokens: TokenItem[] }) {
  if (tokens.length === 0) {
    return (
      <p className="border-t border-border pt-3 text-sm text-muted-foreground">No agents connected yet.</p>
    );
  }
  return (
    <div className="border-t border-border pt-3">
      <h3 className="text-sm font-semibold text-foreground">Connected</h3>
      <ul className="mt-1 flex flex-col">
        {tokens.map((token) => (
          <TokenRow key={token.id} token={token} />
        ))}
      </ul>
    </div>
  );
}

function TokenRow({ token }: { token: TokenItem }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function revoke() {
    startTransition(async () => {
      const result = await revokeAgentToken({ id: token.id });
      if (result.error) setError(result.error);
      setConfirming(false);
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground">{token.name}</span>
        <span className="text-xs text-muted-foreground">
          {token.scopes.map((scope) => SCOPE_LABELS[scope]).join(", ")} · {token.lastUsed} · {token.expiry}
        </span>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
      {confirming ? (
        <span className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Revoke {token.name}?</span>
          <button
            type="button"
            onClick={revoke}
            disabled={pending}
            className="font-semibold text-destructive hover:underline disabled:opacity-50"
          >
            Revoke
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="text-muted-foreground hover:underline">
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Revoke ${token.name}`}
          className="text-sm font-semibold text-destructive hover:underline"
        >
          Revoke
        </button>
      )}
    </li>
  );
}

function ChangesPanel({ feed }: { feed: FeedItem[] }) {
  return (
    <section aria-labelledby="changes-heading" className="flex flex-col gap-3 lg:rounded-xl lg:border lg:border-border lg:bg-card lg:p-6 lg:shadow-sm">
      <h2 id="changes-heading" className="sr-only font-serif text-[22px] leading-tight text-foreground lg:not-sr-only">
        Recent agent changes
      </h2>
      <p className="text-sm text-muted-foreground">
        Everything an agent changed, newest first. Undo puts the old values back.
      </p>
      {feed.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No agent changes yet. When a connected agent edits a contact, it shows up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 lg:gap-0">
          {feed.map((item) => (
            <FeedRow key={item.key} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

const rowClasses =
  "rounded-xl border border-border bg-card p-3.5 lg:rounded-none lg:border-0 lg:border-t lg:border-border/70 lg:bg-transparent lg:px-0 lg:py-2.5";

function FeedRow({ item }: { item: FeedItem }) {
  if (item.kind === "change") {
    return (
      <li className={rowClasses}>
        <ChangeLine change={item.change} meta={`${item.when} · ${item.tokenName}`} />
      </li>
    );
  }
  if (item.kind === "deleted") {
    return (
      <li className={cn(rowClasses, "flex flex-col gap-0.5")}>
        <span className="text-sm text-foreground">
          <strong className="font-semibold">Deleted {item.names.length === 1 ? "1 contact" : `${item.names.length} contacts`}</strong>
          {" · "}
          {item.names.slice(0, 3).join(", ")}
          {item.names.length > 3 ? ` and ${item.names.length - 3} more` : ""}
        </span>
        <span className="text-xs text-muted-foreground">
          {item.when} · {item.tokenName} · Deletes can&apos;t be undone
        </span>
      </li>
    );
  }
  return (
    <li className={rowClasses}>
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-col gap-0.5 [&::-webkit-details-marker]:hidden">
          <span className="text-sm text-foreground">
            <strong className="font-semibold">Bulk: {item.changes.length} contacts</strong>
            {" · "}
            <span className="font-semibold text-primary group-open:hidden">See all</span>
            <span className="hidden font-semibold text-primary group-open:inline">Hide</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {item.when} · {item.tokenName}
          </span>
        </summary>
        <ul className="mt-2 flex flex-col border-l-2 border-border pl-3">
          {item.changes.map((change) => (
            <li key={change.eventId} className="py-2">
              <ChangeLine change={change} meta={change.when} />
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function ChangeLine({ change, meta }: { change: ChangeItem; meta: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function undo() {
    setError(null);
    startTransition(async () => {
      const result = await undoChange({ eventId: change.eventId });
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-semibold text-foreground lg:hidden">{change.contactName}</span>
        <span className="text-sm text-foreground">
          <strong className="hidden font-semibold lg:inline">{change.contactName} · </strong>
          {change.summary}
        </span>
        <span className="text-xs text-muted-foreground">{meta}</span>
        {error ? (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {change.undo.canUndo ? null : (
          <span className="text-xs text-muted-foreground">{change.undo.reason}</span>
        )}
        <button
          type="button"
          onClick={undo}
          disabled={!change.undo.canUndo || pending}
          aria-label={`Undo ${change.summary} for ${change.contactName}`}
          title={change.undo.canUndo ? undefined : change.undo.reason}
          className={cn(outlineButton, "self-start lg:self-auto")}
        >
          {pending ? "Undoing…" : "Undo"}
        </button>
      </div>
    </div>
  );
}
