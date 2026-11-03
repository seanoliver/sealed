/** True for "Sean & Tina", "Sean and Tina", "The Olivers": copy after it needs a plural verb. */
export function isPluralOwnerName(name: string): boolean {
  const trimmed = name.trim();
  if (/\s(&|and|\+)\s/i.test(trimmed) || trimmed.includes(",")) return true;
  // "The Olivers": a family name.
  return /^the\s+\S+s$/i.test(trimmed);
}

export function ownerVerb(name: string, singular: string, plural: string): string {
  return isPluralOwnerName(name) ? plural : singular;
}
