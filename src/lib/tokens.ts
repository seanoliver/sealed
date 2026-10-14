import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Update-token primitives. The raw token goes ONLY into the emailed URL;
 * the database stores nothing but its sha256 (update_tokens.token_hash),
 * so a DB leak never exposes a live link. server-only: this module mints
 * secrets and must never reach a client bundle.
 */

/** Days a freshly minted update token stays valid. */
export const TOKEN_TTL_DAYS = 30;

/**
 * Exact shape of a raw token (32 bytes → 43 chars unpadded base64url).
 * The /u/[token] redirect and the /u/edit page and action gate on this
 * BEFORE any DB work: malformed input must never cost a query.
 */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** sha256 of the raw token — the only form that is ever persisted. */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** 32 random bytes as 43-char unpadded base64url, plus its storage hash. */
export function generateToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
