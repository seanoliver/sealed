"use server";

import { lookupUsZip, type ZipPlace } from "@/lib/address/us-zip";

export async function lookupZip(zip: string): Promise<ZipPlace | null> {
  if (typeof zip !== "string" || !/^\d{5}(-\d{4})?$/.test(zip.trim())) return null;
  return lookupUsZip(zip);
}
