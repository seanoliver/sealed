import { z } from "zod";

const emailSchema = z.email().max(254);

/** Reads a form's trimmed `email` field. Returns null when it is not a valid address. */
export function parseEmailField(formData: FormData): string | null {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  return parsed.success ? parsed.data : null;
}
