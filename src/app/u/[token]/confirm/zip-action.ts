"use server";

import { lookupUsZip, type ZipPlace } from "@/lib/address/us-zip";

/** City and state for a US ZIP, for the recipient's ZIP-first address entry. */
export async function lookupZip(zip: string): Promise<ZipPlace | null> {
  if (typeof zip !== "string" || !/^\d{5}(-\d{4})?$/.test(zip.trim())) return null;
  return lookupUsZip(zip);
}
