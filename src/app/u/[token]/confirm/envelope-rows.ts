import { type AddressPreview } from "@/components/address-fields";
import { type FormatField } from "@/lib/address/countries";

export type Row =
  | { kind: "line"; text: string; tokens: FormatField[]; at: number; uppercased: boolean }
  | { kind: "slot"; tokens: FormatField[]; at: number };

export type OpenAddress = { tokens: FormatField[]; at: number; slot: boolean };

type RowsPreview = Pick<AddressPreview, "envelope" | "name" | "slots">;

/** The envelope's rows in print order. An open address line always has a row, even once it prints nothing. */
export function envelopeRows(preview: RowsPreview, open: OpenAddress | null = null): Row[] {
  const rows: Row[] = preview.envelope
    ? preview.envelope.lines.map((line) => ({ kind: "line", ...line }))
    : preview.name
      ? [{ kind: "line", text: preview.name, tokens: ["N"], at: 0, uppercased: false }]
      : [];
  if (!rows.some((row) => row.tokens.includes("N"))) rows.unshift({ kind: "slot", tokens: ["N"], at: 0 });
  for (const slot of preview.slots) rows.push({ kind: "slot", ...slot });
  if (open && openRowIndex(rows, open) === -1) rows.push({ kind: "slot", tokens: open.tokens, at: open.at });
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => a.row.at - b.row.at || a.i - b.i)
    .map(({ row }) => row);
}

/** The one row that holds the open editor: a local-script street prints several rows at the same `at`. */
export function openRowIndex(rows: Row[], open: Pick<OpenAddress, "at"> | null): number {
  if (!open) return -1;
  return rows.findIndex((row) => !row.tokens.includes("N") && row.at === open.at);
}
