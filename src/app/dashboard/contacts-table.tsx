"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import {
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createSortedRowModel,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  Subscribe,
  tableFeatures,
  useTable,
  type Cell,
  type columnResizingState,
  type ColumnSizingState,
  type ColumnVisibilityState,
  type Header,
  type Row,
  type SubscribeSource,
} from "@tanstack/react-table";
import {
  requestAddresses,
  type RequestAddressesResult,
} from "@/app/dashboard/actions";
import { patchContact } from "@/app/dashboard/contacts/actions";
import {
  changedValues,
  moveCursor,
  parseStoredLayout,
  STATUS_RANK,
  type RowKey,
  type SheetField,
  type SheetRow,
  type SheetValues,
  type StatusKey,
} from "@/lib/contacts-sheet";

const chipBase =
  "inline-flex items-center rounded-full border px-2 py-px text-xs font-medium whitespace-nowrap";

const chipStyles: Record<StatusKey, string> = {
  updated:
    "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200",
  none: "border-border bg-secondary/50 text-muted-foreground",
  sent: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  delivered:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
  opened:
    "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  bounced:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  complained:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
};

const chipLabels: Record<StatusKey, string> = {
  updated: "Updated",
  none: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  bounced: "Bounced",
  complained: "Complained",
};

function StatusChip({ status }: { status: StatusKey }) {
  return (
    <span className={`${chipBase} ${chipStyles[status]}`}>
      {chipLabels[status]}
    </span>
  );
}

type FieldColumn = {
  field: SheetField;
  label: string;
  size: number;
  maxLength: number;
};

const FIELD_COLUMNS: FieldColumn[] = [
  { field: "full_name", label: "Name", size: 170, maxLength: 200 },
  { field: "partner_name", label: "Partner", size: 110, maxLength: 200 },
  { field: "email", label: "Email", size: 200, maxLength: 320 },
  { field: "address_line1", label: "Street", size: 160, maxLength: 200 },
  { field: "city", label: "City", size: 110, maxLength: 120 },
  { field: "state_region", label: "Region", size: 110, maxLength: 120 },
  { field: "postal_code", label: "Postal code", size: 110, maxLength: 20 },
  { field: "country", label: "Country", size: 100, maxLength: 120 },
];

const FIELD_BY_ID = new Map<string, FieldColumn>(
  FIELD_COLUMNS.map((c) => [c.field, c]),
);

const COLUMN_LABELS: Record<string, string> = {
  ...Object.fromEntries(FIELD_COLUMNS.map((c) => [c.field, c.label])),
  status: "Status",
  updated: "Updated",
};

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
  rowSelectionFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  columnResizingFeature,
});

type SheetTableRow = Row<typeof features, SheetRow>;
type SheetHeader = Header<typeof features, SheetRow, unknown>;

const helper = createColumnHelper<typeof features, SheetRow>();

const columns = helper.columns([
  helper.display({
    id: "select",
    size: 40,
    enableSorting: false,
    enableResizing: false,
    enableHiding: false,
  }),
  ...FIELD_COLUMNS.map((c) =>
    helper.accessor((row) => row.values[c.field] || undefined, {
      id: c.field,
      header: c.label,
      size: c.size,
      minSize: 60,
      sortFn: "text",
      sortUndefined: "last",
      enableHiding: c.field !== "full_name",
    }),
  ),
  helper.accessor((row) => STATUS_RANK[row.status], {
    id: "status",
    header: "Status",
    size: 100,
    minSize: 80,
    sortFn: "basic",
    sortDescFirst: false,
  }),
  helper.accessor((row) => row.updatedAtIso, {
    id: "updated",
    header: "Updated",
    size: 110,
    minSize: 80,
    sortFn: "basic",
    sortDescFirst: true,
  }),
  helper.display({
    id: "actions",
    size: 130,
    enableSorting: false,
    enableResizing: false,
    enableHiding: false,
  }),
]);

const DEFAULT_VISIBILITY: ColumnVisibilityState = {
  state_region: false,
  postal_code: false,
};

const LAYOUT_STORAGE_KEY = "sealed.contacts.layout.v1";

function useStoredLayout() {
  const [columnVisibility, setColumnVisibility] =
    useState<ColumnVisibilityState>(DEFAULT_VISIBILITY);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let stored: ReturnType<typeof parseStoredLayout> = {};
    // Storage throws when blocked; the table must still render without it.
    try {
      stored = parseStoredLayout(
        window.localStorage.getItem(LAYOUT_STORAGE_KEY),
      );
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage only exists after hydration
    if (stored.columnVisibility) setColumnVisibility(stored.columnVisibility);
    if (stored.columnSizing) setColumnSizing(stored.columnSizing);
    setRestored(true);
  }, []);

  useEffect(() => {
    // Writing before the restore would replace the stored layout with the defaults.
    if (!restored) return;
    try {
      window.localStorage.setItem(
        LAYOUT_STORAGE_KEY,
        JSON.stringify({ columnVisibility, columnSizing }),
      );
    } catch {}
  }, [restored, columnVisibility, columnSizing]);

  return {
    columnVisibility,
    setColumnVisibility,
    columnSizing,
    setColumnSizing,
  };
}

const ROW_KEYS: ReadonlySet<string> = new Set<RowKey>([
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

const buttonClasses =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClasses =
  "inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50";
const cellInputClasses =
  "h-7 w-full min-w-0 rounded-md border border-input bg-background px-1.5 text-sm text-foreground outline-none read-only:opacity-60 focus:border-ring focus:ring-2 focus:ring-ring/25";
const kbdClasses =
  "rounded border border-b-2 border-border bg-card px-1 font-mono text-[11px] text-foreground/80";
const cellClasses = "h-9 border-b border-border/60 px-2.5";

const SAVE_FAILED = "Couldn't save. Check your connection and try again.";
const SAVE_STALLED = "Still saving. The change may go through even if you cancel.";
const SAVE_STALL_MS = 15_000;
const SAVE_PENDING = "Still saving your last change. Try again when it finishes.";
const SEND_PENDING = "Still sending address requests. Try again when they finish.";

/**
 * Ids are captured when the dialog opens so the send targets exactly what the
 * user confirmed. There is deliberately no "whole book" mode: with an active
 * search the table shows a filtered subset, and a server-side fan-out would
 * email (and rotate the live links of) contacts the dialog never mentioned.
 */
type ConfirmState = {
  mode: "selected" | "shown";
  ids: string[];
  sendable: number;
  skipped: number;
};

type EditState = { id: string; error?: string; stalled?: boolean };

type SavedOverlay = {
  id: string;
  values: Partial<SheetValues>;
  rows: SheetRow[];
};

export function ContactsTable({ rows }: { rows: SheetRow[] }) {
  const router = useRouter();
  const layout = useStoredLayout();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [result, setResult] = useState<RequestAddressesResult | null>(null);
  const [isSending, startSend] = useTransition();
  // Not useTransition: its pending flag clears after updates made past the
  // await have committed, so an error would show while still "saving".
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  // Not isSending: it stays true until the send's refreshed rows commit.
  const sendingRef = useRef(false);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => {
    editingIdRef.current = editState?.id ?? null;
  }, [editState]);
  const [refocusId, setRefocusId] = useState<string | null>(null);
  // The action resolves before its refreshed rows commit; until they do, show
  // the saved values so the row does not flash back to the old ones.
  const [saved, setSaved] = useState<SavedOverlay | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  const table = useTable(
    {
      features,
      columns,
      data: rows,
      getRowId: (row) => row.id,
      enableRowSelection: (row) => row.original.values.email !== "",
      columnResizeMode: "onEnd",
      state: {
        columnVisibility: layout.columnVisibility,
        columnSizing: layout.columnSizing,
      },
      onColumnVisibilityChange: layout.setColumnVisibility,
      onColumnSizingChange: layout.setColumnSizing,
    },
    // Leaves out columnResizing, which changes on every pointer move of a drag.
    (state) => ({
      sorting: state.sorting,
      rowSelection: state.rowSelection,
      columnVisibility: state.columnVisibility,
      columnSizing: state.columnSizing,
    }),
  );

  const sortedRows = table.getRowModel().rows;
  const selectedIds = table
    .getSelectedRowModel()
    .rows.filter((row) => row.getCanSelect())
    .map((row) => row.id);
  const emailableCount = useMemo(
    () => rows.filter((row) => row.values.email !== "").length,
    [rows],
  );
  const activeRowId =
    cursorId !== null && sortedRows.some((row) => row.id === cursorId)
      ? cursorId
      : (sortedRows[0]?.id ?? null);
  // The edited contact can vanish on a refresh (deleted in another tab).
  const editing =
    editState && rows.some((row) => row.id === editState.id) ? editState : null;

  function focusRow(id: string) {
    setCursorId(id);
    rowRefs.current.get(id)?.focus();
  }

  function startEdit(row: SheetTableRow) {
    if (editing) {
      rowRefs.current
        .get(editing.id)
        ?.querySelector<HTMLInputElement>("input[data-cell-input]")
        ?.focus();
      return;
    }
    if (savingRef.current || sendingRef.current) {
      setNotice(savingRef.current ? SAVE_PENDING : SEND_PENDING);
      return;
    }
    setNotice(null);
    setCursorId(row.id);
    setEditState({ id: row.id });
  }

  function finishEdit(id: string, { refocus = true }: { refocus?: boolean } = {}) {
    setEditState(null);
    setCursorId(id);
    if (refocus) setRefocusId(id);
  }

  function saveEdit(row: SheetTableRow, draft: Partial<SheetValues>) {
    if (savingRef.current) return;
    if (sendingRef.current) {
      setEditState((current) =>
        current?.id === row.id ? { id: row.id } : current,
      );
      setNotice(SEND_PENDING);
      return;
    }
    const patch = changedValues(row.original.values, draft);
    if (Object.keys(patch).length === 0) {
      finishEdit(row.id);
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    const stallTimer = setTimeout(() => {
      setEditState((current) =>
        current?.id === row.id
          ? { id: row.id, error: SAVE_STALLED, stalled: true }
          : current,
      );
    }, SAVE_STALL_MS);
    void (async () => {
      let error: string | undefined;
      try {
        error = (await patchContact(row.id, patch)).error;
      } catch {
        error = SAVE_FAILED;
      }
      clearTimeout(stallTimer);
      savingRef.current = false;
      setIsSaving(false);
      const stillEditing = editingIdRef.current === row.id;
      if (error && stillEditing) {
        setEditState({ id: row.id, error });
      } else if (error) {
        setNotice(
          `Your change to ${row.original.values.full_name} wasn't saved. ${error}`,
        );
      } else {
        setNotice((current) => (current === SAVE_PENDING ? null : current));
        setSaved({ id: row.id, values: patch, rows });
        const active = document.activeElement;
        const focusInRow =
          active === null ||
          active === document.body ||
          Boolean(rowRefs.current.get(row.id)?.contains(active));
        if (stillEditing) finishEdit(row.id, { refocus: focusInRow });
      }
    })();
  }

  function onRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    row: SheetTableRow,
    index: number,
  ) {
    const target = event.target as HTMLElement;
    const onRow = target === event.currentTarget;
    const onControl =
      target instanceof HTMLAnchorElement ||
      (target instanceof HTMLInputElement && target.type === "checkbox");
    if (ROW_KEYS.has(event.key) && (onRow || onControl)) {
      event.preventDefault();
      const next =
        sortedRows[moveCursor(event.key as RowKey, index, sortedRows.length)];
      if (next) focusRow(next.id);
      return;
    }
    if (!onRow || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === " ") {
      event.preventDefault();
      if (row.getCanSelect()) row.toggleSelected();
    } else if (event.key === "Enter") {
      event.preventDefault();
      startEdit(row);
    } else if (event.key === "o" || event.key === "O") {
      event.preventDefault();
      router.push(`/dashboard/contacts/${row.id}`);
    }
  }

  function fire(input: Parameters<typeof requestAddresses>[0]) {
    setConfirm(null);
    setResult(null);
    sendingRef.current = true;
    startSend(async () => {
      let res: RequestAddressesResult;
      try {
        res = await requestAddresses(input);
      } catch {
        res = { error: "Couldn't send. Check your connection and try again." };
      }
      sendingRef.current = false;
      setResult(res);
      setNotice((current) => (current === SEND_PENDING ? null : current));
      if (!("error" in res)) table.resetRowSelection(true);
    });
  }

  const banner =
    result === null ? null : "error" in result ? (
      <p
        role="alert"
        className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      >
        {result.error}
      </p>
    ) : (
      <p
        role="status"
        className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
      >
        {[
          `Sent ${result.sent} ${result.sent === 1 ? "request" : "requests"}`,
          result.skippedNoEmail > 0
            ? `${result.skippedNoEmail} skipped (no email)`
            : null,
          result.failed > 0 ? `${result.failed} failed` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    );

  const selectedCount = selectedIds.length;
  const hideableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide());

  return (
    <div>
      {banner}

      <div
        role="toolbar"
        aria-label="Contact actions"
        className={`mt-4 flex flex-wrap items-center gap-2 rounded-xl px-2 py-1.5 transition-colors ${
          selectedCount > 0 ? "bg-primary/10" : ""
        }`}
      >
        {selectedCount > 0 ? (
          <span className="px-1 text-sm font-medium text-foreground">
            {selectedCount} selected
          </span>
        ) : null}
        <button
          type="button"
          disabled={selectedCount === 0 || isSending || isSaving}
          onClick={() =>
            setConfirm({
              mode: "selected",
              ids: selectedIds,
              sendable: selectedCount,
              skipped: 0,
            })
          }
          className={selectedCount > 0 ? primaryButtonClasses : buttonClasses}
        >
          Request addresses{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </button>
        <button
          type="button"
          disabled={rows.length === 0 || isSending || isSaving}
          onClick={() =>
            // All VISIBLE rows (search-filtered), never the whole book. The
            // no-email ones are included so the server reports them skipped.
            // slice: the action caps at 1000 ids per request.
            setConfirm({
              mode: "shown",
              ids: rows.slice(0, 1000).map((row) => row.id),
              sendable: emailableCount,
              skipped: rows.length - emailableCount,
            })
          }
          className={buttonClasses}
        >
          Send to all shown
        </button>
        {selectedCount > 0 ? (
          <button
            type="button"
            onClick={() => table.resetRowSelection(true)}
            className={buttonClasses}
          >
            Clear selection
          </button>
        ) : null}
        {isSending ? (
          <span className="text-sm text-muted-foreground">Sending…</span>
        ) : null}
        <span className="flex-1" />
        <div className="hidden md:block">
          <Menu.Root>
            <Menu.Trigger className={buttonClasses}>Columns</Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                sideOffset={6}
                align="end"
                className="z-50 outline-none"
              >
                <Menu.Popup className="min-w-44 rounded-lg border border-border bg-card p-1 text-sm text-foreground shadow-md outline-none">
                  {hideableColumns.map((column) => (
                    <Menu.CheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(checked) =>
                        column.toggleVisibility(checked)
                      }
                      closeOnClick={false}
                      className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-highlighted:bg-muted"
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-4 items-center justify-center rounded border border-input"
                      >
                        <Menu.CheckboxItemIndicator>
                          <svg
                            viewBox="0 0 16 16"
                            className="size-3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                          </svg>
                        </Menu.CheckboxItemIndicator>
                      </span>
                      {COLUMN_LABELS[column.id]}
                    </Menu.CheckboxItem>
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>

      {confirm ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Confirm address request"
          className="mt-3 rounded-xl border border-input bg-card p-4 shadow-sm"
        >
          <p className="text-sm text-foreground/80">
            Send address requests to{" "}
            <strong>
              {confirm.mode === "shown"
                ? `the ${confirm.sendable} ${confirm.sendable === 1 ? "contact" : "contacts"} shown`
                : `${confirm.sendable} ${confirm.sendable === 1 ? "contact" : "contacts"}`}
            </strong>
            {confirm.skipped > 0 ? (
              <> ({confirm.skipped} will be skipped: no email)</>
            ) : null}
            ? Each gets a personal update link that expires in 30 days; any
            previously sent links stop working.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={confirm.sendable === 0 || isSending || isSaving}
              onClick={() => fire({ contactIds: confirm.ids })}
              className={primaryButtonClasses}
            >
              Confirm and send
            </button>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className={buttonClasses}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {(editing?.error ?? notice) ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {editing?.error ?? notice}
        </p>
      ) : null}

      <div className="hidden md:block">
          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table
              aria-label="Contacts"
              className="table-fixed border-separate border-spacing-0 text-sm"
              style={{ width: table.getTotalSize(), minWidth: "100%" }}
            >
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <HeaderCell
                        key={header.id}
                        header={header}
                        resizing={table.atoms.columnResizing}
                        allSelected={table.getIsAllRowsSelected()}
                        canSelectAny={emailableCount > 0}
                        onToggleAll={() => table.toggleAllRowsSelected()}
                      />
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {sortedRows.map((row, index) => {
                  const shared = {
                    row,
                    cells: row.getVisibleCells(),
                    isSelected: row.getIsSelected(),
                    setRef: (el: HTMLTableRowElement | null) => {
                      if (el) rowRefs.current.set(row.id, el);
                      else rowRefs.current.delete(row.id);
                    },
                  };
                  return editing?.id === row.id ? (
                    <EditingRow
                      key={row.id}
                      {...shared}
                      isSaving={isSaving}
                      canCancel={!isSaving || Boolean(editing.stalled)}
                      onSave={(draft) => saveEdit(row, draft)}
                      onCancel={() => finishEdit(row.id)}
                    />
                  ) : (
                    <ViewRow
                      key={row.id}
                      {...shared}
                      values={
                        saved?.id === row.id && saved.rows === rows
                          ? { ...row.original.values, ...saved.values }
                          : row.original.values
                      }
                      isActive={row.id === activeRowId}
                      focusOnMount={row.id === refocusId}
                      onRefocused={() => setRefocusId(null)}
                      onFocusRow={() => setCursorId(row.id)}
                      onEdit={() => startEdit(row)}
                      onKeyDown={(event) => onRowKeyDown(event, row, index)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <kbd className={kbdClasses}>↑</kbd>{" "}
              <kbd className={kbdClasses}>↓</kbd> move
            </span>
            <span>
              <kbd className={kbdClasses}>Space</kbd> select
            </span>
            <span>
              <kbd className={kbdClasses}>Enter</kbd> edit or save
            </span>
            <span>
              <kbd className={kbdClasses}>Esc</kbd> cancel
            </span>
            <span>
              <kbd className={kbdClasses}>O</kbd> open
            </span>
            <span>Double-click a row to edit it</span>
          </p>
      </div>
        <ul
          aria-label="Contacts"
          className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card md:hidden"
        >
          {sortedRows.map((row) => {
            const { values } = row.original;
            const place = [values.address_line1, values.city]
              .filter(Boolean)
              .join(", ");
            return (
              <li
                key={row.id}
                className="flex min-h-14 items-center gap-3 px-4 py-2"
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${values.full_name}`}
                  checked={row.getIsSelected()}
                  disabled={!row.getCanSelect()}
                  onChange={() => row.toggleSelected()}
                  className="size-5 shrink-0 accent-primary disabled:opacity-40"
                />
                <Link
                  href={`/dashboard/contacts/${row.id}`}
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate text-sm font-medium text-foreground">
                    {values.full_name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {place || "No address yet"}
                  </span>
                </Link>
                <StatusChip status={row.original.status} />
              </li>
            );
          })}
        </ul>
    </div>
  );
}

function HeaderCell({
  header,
  resizing,
  allSelected,
  canSelectAny,
  onToggleAll,
}: {
  header: SheetHeader;
  resizing: SubscribeSource<columnResizingState>;
  allSelected: boolean;
  canSelectAny: boolean;
  onToggleAll: () => void;
}) {
  const column = header.column;
  const sorted = column.getIsSorted();
  return (
    <th
      scope="col"
      aria-sort={
        sorted === "asc"
          ? "ascending"
          : sorted === "desc"
            ? "descending"
            : undefined
      }
      style={{ width: header.getSize() }}
      className="relative h-8 border-b border-border bg-secondary/40 px-2.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
    >
      {column.id === "select" ? (
        <input
          type="checkbox"
          aria-label="Select all contacts with an email"
          checked={allSelected}
          disabled={!canSelectAny}
          onChange={onToggleAll}
          className="size-4 align-middle accent-primary"
        />
      ) : column.id === "actions" ? (
        <span className="sr-only">Actions</span>
      ) : (
        <button
          type="button"
          onClick={column.getToggleSortingHandler()}
          className="inline-flex max-w-full items-center gap-1 truncate uppercase hover:text-foreground"
        >
          {COLUMN_LABELS[column.id]}
          <span aria-hidden="true" className="text-[10px]">
            {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}
          </span>
        </button>
      )}
      {column.getCanResize() ? (
        <Subscribe
          source={resizing}
          selector={(state) =>
            state.isResizingColumn === column.id
              ? (state.deltaOffset ?? 0)
              : null
          }
        >
          {(offset) => (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize ${COLUMN_LABELS[column.id]}`}
              onMouseDown={header.getResizeHandler()}
              onTouchStart={header.getResizeHandler()}
              onDoubleClick={() => column.resetSize()}
              style={
                offset === null
                  ? undefined
                  : { transform: `translateX(${offset}px)` }
              }
              className={`absolute top-1.5 right-0 bottom-1.5 w-1 cursor-col-resize touch-none rounded select-none ${
                offset === null ? "bg-border hover:bg-primary/60" : "bg-primary"
              }`}
            />
          )}
        </Subscribe>
      ) : null}
    </th>
  );
}

type RowProps = {
  row: SheetTableRow;
  cells: Cell<typeof features, SheetRow, unknown>[];
  isSelected: boolean;
  setRef: (el: HTMLTableRowElement | null) => void;
};

function SelectCell({ row, isSelected }: Pick<RowProps, "row" | "isSelected">) {
  return (
    <td className={cellClasses}>
      <input
        type="checkbox"
        // The row is the Tab stop; Space on the row toggles this.
        tabIndex={-1}
        aria-label={`Select ${row.original.values.full_name}`}
        checked={isSelected}
        disabled={!row.getCanSelect()}
        title={
          row.getCanSelect()
            ? undefined
            : "No email address. Add one to request an update."
        }
        onChange={() => row.toggleSelected()}
        className="size-4 align-middle accent-primary disabled:cursor-not-allowed disabled:opacity-40"
      />
    </td>
  );
}

function StaticCell({
  row,
  columnId,
}: {
  row: SheetTableRow;
  columnId: "status" | "updated";
}) {
  return columnId === "status" ? (
    <td className={cellClasses}>
      <StatusChip status={row.original.status} />
    </td>
  ) : (
    <td
      className={`${cellClasses} truncate whitespace-nowrap text-foreground/80`}
    >
      {row.original.updatedAtLabel}
    </td>
  );
}

function ViewRow({
  row,
  cells,
  isSelected,
  setRef,
  values,
  isActive,
  focusOnMount,
  onRefocused,
  onFocusRow,
  onEdit,
  onKeyDown,
}: RowProps & {
  values: SheetValues;
  isActive: boolean;
  focusOnMount: boolean;
  onRefocused: () => void;
  onFocusRow: () => void;
  onEdit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => void;
}) {
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (!focusOnMount) return;
    rowRef.current?.focus();
    onRefocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);
  return (
    <tr
      ref={(el) => {
        rowRef.current = el;
        setRef(el);
      }}
      tabIndex={isActive ? 0 : -1}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocusRow();
      }}
      onDoubleClick={onEdit}
      onKeyDown={onKeyDown}
      className={`group outline-none focus-visible:[&>td]:bg-primary/10 focus-visible:[&>td:first-child]:shadow-[inset_2px_0_0_var(--color-primary)] ${
        isSelected ? "[&>td]:bg-primary/5" : "hover:[&>td]:bg-muted/50"
      }`}
    >
      {cells.map((cell) => {
        const id = cell.column.id;
        const field = FIELD_BY_ID.get(id);
        if (id === "select") {
          return <SelectCell key={cell.id} row={row} isSelected={isSelected} />;
        }
        if (id === "status" || id === "updated") {
          return <StaticCell key={cell.id} row={row} columnId={id} />;
        }
        if (field) {
          const value = values[field.field];
          return (
            <td
              key={cell.id}
              className={`${cellClasses} truncate text-foreground/80`}
            >
              {field.field === "full_name" ? (
                <Link
                  href={`/dashboard/contacts/${row.id}`}
                  tabIndex={-1}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {value}
                </Link>
              ) : (
                value || <span className="text-muted-foreground/50">—</span>
              )}
            </td>
          );
        }
        return (
          <td key={cell.id} className={`${cellClasses} text-right`}>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Edit ${values.full_name}`}
              onClick={onEdit}
              className="h-7 rounded-md px-2 text-xs font-medium text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:bg-muted hover:text-foreground"
            >
              Edit
            </button>
          </td>
        );
      })}
    </tr>
  );
}

function EditingRow({
  row,
  cells,
  isSelected,
  setRef,
  isSaving,
  canCancel,
  onSave,
  onCancel,
}: RowProps & {
  isSaving: boolean;
  canCancel: boolean;
  onSave: (draft: Partial<SheetValues>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Partial<SheetValues>>({});
  const { values } = row.original;
  const firstFieldId = cells.find((cell) => FIELD_BY_ID.has(cell.column.id))
    ?.column.id;

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSave(draft);
    }
  }

  return (
    <tr
      ref={setRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.nativeEvent.isComposing &&
          canCancel
        ) {
          event.preventDefault();
          onCancel();
        }
      }}
      className="[&>td]:bg-background"
    >
      {cells.map((cell) => {
        const id = cell.column.id;
        const field = FIELD_BY_ID.get(id);
        if (id === "select") {
          return <SelectCell key={cell.id} row={row} isSelected={isSelected} />;
        }
        if (id === "status" || id === "updated") {
          return <StaticCell key={cell.id} row={row} columnId={id} />;
        }
        if (field) {
          return (
            <td key={cell.id} className={`${cellClasses} px-1`}>
              <input
                data-cell-input
                aria-label={field.label}
                maxLength={field.maxLength}
                autoFocus={id === firstFieldId}
                readOnly={isSaving}
                value={draft[field.field] ?? values[field.field]}
                onChange={(event) =>
                  setDraft({ ...draft, [field.field]: event.target.value })
                }
                onKeyDown={onInputKeyDown}
                className={cellInputClasses}
              />
            </td>
          );
        }
        return (
          <td
            key={cell.id}
            className={`${cellClasses} px-1 text-right whitespace-nowrap`}
          >
            <span className="inline-flex gap-1">
              <button
                type="button"
                aria-disabled={isSaving}
                onClick={() => onSave(draft)}
                className="h-7 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/80 aria-disabled:opacity-50"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={!canCancel}
                onClick={onCancel}
                className="h-7 rounded-md border border-input px-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
            </span>
          </td>
        );
      })}
    </tr>
  );
}
