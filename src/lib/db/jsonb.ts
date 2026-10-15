const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

export const sameJsonb = (a: unknown, b: unknown) => canonical(a) === canonical(b);
