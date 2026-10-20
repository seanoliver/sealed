import { z } from "zod";
import "./zod-locale";
import { isCountryCode } from "@/lib/address/countries";
import { BOOK_LINK_SHAPE } from "@/lib/book-link";

export const bookSchema = z.object({
  display_name: z.string().trim().min(1).max(200),
  slug: z.string().regex(BOOK_LINK_SHAPE,
    "3-63 chars; lowercase letters, numbers, hyphens; must start alphanumeric"),
  partner_name: z.boolean(),
  kids_names: z.boolean(),
  birthday: z.boolean(),
});
export type BookInput = z.infer<typeof bookSchema>;

export const senderCountrySchema = z
  .string()
  .trim()
  .refine(isCountryCode, "Pick the country you mail from");
