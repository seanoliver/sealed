import { type AddressPreview } from "@/components/address-fields";
import { type Country, type FormatField } from "@/lib/address/countries";

export type Row =
  | { kind: "line"; text: string; tokens: FormatField[]; at: number; uppercased: boolean }
  | { kind: "slot"; tokens: FormatField[]; at: number };

export type OpenAddress = { tokens: FormatField[]; at: number; slot: boolean };

type RowsPreview = Pick<AddressPreview, "envelope" | "name" | "slots"> & Partial<Pick<AddressPreview, "partial">>;

/** The envelope's rows in print order. An open address line always has a row, even once it prints nothing. */
export function envelopeRows(preview: RowsPreview, open: OpenAddress | null = null): Row[] {
  const rows: Row[] = preview.envelope
    ? preview.envelope.lines.map((line) => ({ kind: "line", ...line }))
    : preview.name
      ? [{ kind: "line", text: preview.name, tokens: ["N"], at: 0, uppercased: false }]
      : [];
  if (!preview.envelope) rows.push(...(preview.partial ?? []).map((line) => ({ kind: "line" as const, ...line })));
  if (!rows.some((row) => row.tokens.includes("N"))) rows.unshift({ kind: "slot", tokens: ["N"], at: 0 });
  for (const slot of preview.slots) rows.push({ kind: "slot", ...slot });
  if (open && openRowIndex(rows, open) === -1) rows.push({ kind: "slot", tokens: open.tokens, at: open.at });
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => a.row.at - b.row.at || a.i - b.i)
    .map(({ row }) => row);
}

/** The one row that holds the open editor: a local-script street prints several rows at the same `at`. */
export function openRowIndex(rows: Row[], open: Pick<OpenAddress, "tokens" | "at"> | null): number {
  if (!open) return -1;
  // The street is found by its token, not its `at`: a country change can move it to another line.
  if (open.tokens.includes("A")) return rows.findIndex((row) => row.tokens.includes("A"));
  return rows.findIndex((row) => !row.tokens.includes("N") && row.at === open.at);
}

const FORMAT_FIELDS = new Set<string>(["N", "O", "A", "D", "C", "S", "Z"]);

/** The street's line in a country's format. Tokens cover both scripts' formats, which differ only in what shares the street's line. */
export function streetLine(country: Country | null): Pick<OpenAddress, "tokens" | "at"> {
  const formats = country ? [country.fmt, country.lfmt ?? country.fmt] : ["%A"];
  const lines = formats.map((fmt) => fmt.split("%n").find((line) => line.includes("%A")) ?? "%A");
  const tokens = new Set(
    lines.flatMap((line) => [...line.matchAll(/%([A-Z])/g)].map((match) => match[1])),
  );
  return {
    tokens: [...tokens].filter((token): token is FormatField => FORMAT_FIELDS.has(token)),
    at: Math.max(0, formats[0].split("%n").findIndex((line) => line.includes("%A"))),
  };
}
