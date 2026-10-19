import { z } from "zod";
import "./zod-locale";

const emailSchema = z.email().max(254);

export function parseEmailField(formData: FormData): string | null {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  return parsed.success ? parsed.data : null;
}
