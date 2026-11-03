import "server-only";
// GeoNames US postal codes (CC BY 4.0, https://www.geonames.org), reduced to
// ZIP → [state, place, ...]. Regenerate with scripts/build-us-zips.py.
import data from "./data/us-zips.json";

const zips = data as Record<string, string[]>;

export type ZipPlace = { state: string; city: string };

export function lookupUsZip(zip: string): ZipPlace | null {
  const entry = zips[zip.trim().slice(0, 5)];
  if (!entry || entry.length < 2) return null;
  return { state: entry[0], city: entry[1] };
}

const norm = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");

/** Advisory only: GeoNames names some ZIPs differently ("Brooklyn" vs "New York"), so callers must let the recipient keep theirs. */
export function zipMismatch(
  zip: string,
  { city, state }: { city: string; state: string },
): ZipPlace | null {
  const place = lookupUsZip(zip);
  if (!place) return null;
  const cityOk = city.trim() === "" || norm(city) === norm(place.city);
  const stateOk = state.trim() === "" || state.trim().toUpperCase() === place.state;
  return cityOk && stateOk ? null : place;
}
