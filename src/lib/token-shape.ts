/**
 * Exact shape of a raw update token (32 bytes → 43 chars unpadded base64url).
 * Kept apart from tokens.ts, which is server-only, so client code can match it.
 */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
