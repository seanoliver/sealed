export const AGENT_SCOPES = ["read", "write", "send"] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

// No scope implies another: `send` emails real people, so `write` must never grant it.
export function hasScope(granted: readonly string[], scope: AgentScope): boolean {
  return granted.includes(scope);
}

export class AgentScopeError extends Error {
  constructor(readonly scope: AgentScope) {
    super(`This token lacks the "${scope}" scope.`);
    this.name = "AgentScopeError";
  }
}

export function requireScope(granted: readonly string[], scope: AgentScope): void {
  if (!hasScope(granted, scope)) throw new AgentScopeError(scope);
}
