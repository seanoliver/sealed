import "server-only";
// GeoNames US postal codes (CC BY 4.0, https://www.geonames.org), reduced to
// ZIP → [state, place, ...]. Regenerate with scripts/build-us-zips.py.
import data from "./data/us-zips.json";
import { type ZipPlace } from "./zip-agree";

export type { ZipPlace };

const zips = data as Record<string, string[]>;

export function lookupUsZip(zip: string): ZipPlace | null {
  const entry = zips[zip.trim().slice(0, 5)];
  if (!entry || entry.length < 2) return null;
  return { state: entry[0], city: entry[1] };
}
