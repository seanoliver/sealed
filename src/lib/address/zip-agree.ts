export type ZipPlace = { state: string; city: string };

/** Lowercase letters only, so "St. Louis" and "st louis" compare equal. */
export const normCity = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");

/** True when the typed city or state disagrees with where the ZIP is. Blank fields agree. */
export function zipDisagrees(place: ZipPlace, { city, state }: { city: string; state: string }): boolean {
  const cityOk = city.trim() === "" || normCity(city) === normCity(place.city);
  const stateOk = state.trim() === "" || state.trim().toUpperCase() === place.state;
  return !(cityOk && stateOk);
}
