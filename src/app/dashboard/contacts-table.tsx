"use client";

import {
  Fragment,
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
  type SortFn,
  type SubscribeSource,
} from "@tanstack/react-table";
import {
  requestAddresses,
  type RequestAddressesResult,
} from "@/app/dashboard/actions";
import { patchContact } from "@/app/dashboard/contacts/actions";
import {
  approveMerge,
  reject,
  type ReviewActionState,
} from "@/app/dashboard/review/actions";
import {
  changedValues,
  draftFromNames,
  draftToValues,
  emailCount,
  householdEdited,
  householdPatchInput,
  moveCursor,
  namesFromValues,
  parseStoredLayout,
  sheetName,
  STATUS_RANK,
  validateHousehold,
  type AnswerSide,
  type HouseholdDraft,
  type RowKey,
  type SheetField,
  type SheetRow,
  type SheetValues,
  type StatusKey,
  type TwoAnswers,
} from "@/lib/contacts-sheet";
import type { FailureReason } from "@/lib/email/resend";
import { compareLastName, lastNameKey, type StoredNames } from "@/lib/names";
import { type HouseholdFieldErrors } from "@/lib/validation/household";
import {
  HouseholdLabel,
  HouseholdNameCell,
  UnsplitDot,
} from "./household-panel";

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
  failed:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  unconfirmed:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

const chipLabels: Record<StatusKey, string> = {
  updated: "Updated",
  none: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  bounced: "Bounced",
  complained: "Complained",
  failed: "Not sent",
  unconfirmed: "Unconfirmed",
};

const failureLabels: Record<FailureReason, string> = {
  rejected: "Invalid email",
  quota: "Daily limit hit",
  error: "Send failed",
};

const failureTitles: Record<FailureReason, string> = {
  rejected: "Not sent: the email provider rejected this address.",
  quota: "Not sent: the daily sending limit was reached. Try again tomorrow.",
  error: "Not sent: the email provider returned an error.",
};

function StatusChip({
  status,
  failureReason,
  person,
}: {
  status: StatusKey;
  failureReason: FailureReason | null;
  person?: string;
}) {
  const label =
    status === "failed" && failureReason
      ? failureLabels[failureReason]
      : chipLabels[status];
  return (
    <span
      className={`${chipBase} ${chipStyles[status]}`}
      title={status === "failed" && failureReason ? failureTitles[failureReason] : undefined}
    >
      {person ? `${person} · ${label}` : label}
    </span>
  );
}

function StatusChips({ row }: { row: SheetRow }) {
  if (row.status === "updated" || row.people.length === 0) {
    return <StatusChip status={row.status} failureReason={row.failureReason} />;
  }
  return (
    <>
      {row.people.map((person) => (
        <StatusChip
          key={person.name}
          status={person.status}
          failureReason={person.failureReason}
          person={person.name}
        />
      ))}
    </>
  );
}

const answersChipClasses =
  "border-amber-200 bg-amber-50 font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";

type FieldColumn = {
  field: SheetField;
  label: string;
  size: number;
  maxLength: number;
};

const FIELD_COLUMNS: FieldColumn[] = [
  { field: "email", label: "Emails", size: 210, maxLength: 320 },
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
  full_name: "Name",
  ...Object.fromEntries(FIELD_COLUMNS.map((c) => [c.field, c.label])),
  status: "Status",
  updated: "Updated",
};

// Keep the "full_name" id so saved column widths still apply.
const NAME_COLUMN = "full_name";
const LAST_NAME_COLUMN = "last_name";

const COLUMN_IDS = [
  "select",
  NAME_COLUMN,
  ...FIELD_COLUMNS.map((c) => c.field),
  "status",
  "updated",
  LAST_NAME_COLUMN,
  "actions",
];

const sortFn_lastName: SortFn<typeof features, SheetRow> = (a, b, columnId) =>
  compareLastName(
    a.getValue(columnId) as { first: string; last: string },
    b.getValue(columnId) as { first: string; last: string },
  );

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
  helper.accessor((row) => sheetName(row.names).line, {
    id: NAME_COLUMN,
    header: "Name",
    size: 230,
    minSize: 100,
    sortFn: "text",
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
    }),
  ),
  helper.accessor((row) => STATUS_RANK[row.status], {
    id: "status",
    header: "Status",
    size: 160,
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
  helper.accessor((row) => lastNameKey(row.names), {
    id: LAST_NAME_COLUMN,
    sortFn: sortFn_lastName,
    sortUndefined: "last",
    enableHiding: false,
    enableResizing: false,
  }),
  helper.display({
    id: "actions",
    size: 120,
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
        { columnIds: COLUMN_IDS },
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
  mode: "selected" | "shown" | "attention";
  ids: string[];
  sendable: number;
  emails: number;
  skipped: number;
  replacedLinks: number;
};

const HAS_LINK: ReadonlySet<StatusKey> = new Set([
  "sent",
  "delivered",
  "opened",
  "unconfirmed",
]);

type EditState = { id: string; error?: string; stalled?: boolean };

type SavedOverlay = {
  id: string;
  values: Partial<SheetValues>;
  names?: StoredNames;
  rows: SheetRow[];
};

type SortChoice = "default" | "last_name";

export function ContactsTable({ rows: allRows }: { rows: SheetRow[] }) {
  const [attentionIds, setAttentionIds] = useState<ReadonlySet<string> | null>(null);
  const attentionCount = useMemo(
    () => allRows.filter((row) => row.needsAttention).length,
    [allRows],
  );
  const rows = useMemo(
    () => (attentionIds ? allRows.filter((row) => attentionIds.has(row.id)) : allRows),
    [allRows, attentionIds],
  );
  const [sendLost, setSendLost] = useState(false);
  const attentionSnapshot = () =>
    new Set([
      ...allRows.filter((row) => row.needsAttention).map((row) => row.id),
      ...(editingIdRef.current ? [editingIdRef.current] : []),
    ]);
  const countEmails = (ids: string[]) => {
    const wanted = new Set(ids);
    return allRows
      .filter((row) => wanted.has(row.id))
      .reduce((sum, row) => sum + emailCount(row.values), 0);
  };
  const linkedCount = (ids: string[]) => {
    const wanted = new Set(ids);
    return allRows.filter(
      (row) => wanted.has(row.id) && HAS_LINK.has(row.status),
    ).length;
  };
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
  const [answersId, setAnswersId] = useState<string | null>(null);
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
      enableRowSelection: (row) => emailCount(row.original.values) > 0,
      columnResizeMode: "onEnd",
      state: {
        columnVisibility: {
          ...layout.columnVisibility,
          [LAST_NAME_COLUMN]: false,
        },
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
    () => rows.filter((row) => emailCount(row.values) > 0).length,
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
        ?.querySelector<HTMLElement>("[data-cell-input]")
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

  function saveEdit(
    row: SheetTableRow,
    draft: Partial<SheetValues>,
    household: { draft: HouseholdDraft; base: StoredNames } | null,
  ) {
    if (savingRef.current) return;
    if (sendingRef.current) {
      setEditState((current) =>
        current?.id === row.id ? { id: row.id } : current,
      );
      setNotice(SEND_PENDING);
      return;
    }
    const patch = changedValues(row.original.values, draft);
    const names =
      household && householdEdited(household.base, household.draft)
        ? draftToValues(household.draft)
        : null;
    if (Object.keys(patch).length === 0 && names === null) {
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
        error = (
          await patchContact(row.id, {
            values: patch,
            household: names ? householdPatchInput(names) : undefined,
            namesBase: names && household ? household.base : undefined,
          })
        ).error;
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
          `Your change to ${row.original.names.fullName} wasn't saved. ${error}`,
        );
      } else {
        setNotice((current) => (current === SAVE_PENDING ? null : current));
        setSaved({
          id: row.id,
          values: patch,
          names: names ? namesFromValues(names) : undefined,
          rows,
        });
        const active = document.activeElement;
        const focusInRow =
          active === null ||
          active === document.body ||
          Boolean(rowRefs.current.get(row.id)?.contains(active)) ||
          Boolean(active.closest("[data-household-panel]"));
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
        setSendLost(true);
        res = {
          error:
            "The send may not have finished, and the server may still be sending. Wait about 5 minutes, then reload to see who got an email.",
        };
      }
      sendingRef.current = false;
      setResult(res);
      setNotice((current) => (current === SEND_PENDING ? null : current));
      if (!("error" in res)) table.resetRowSelection(true);
    });
  }

  const banner =
    result === null ? null : "error" in result ? (
      <div
        role="alert"
        className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      >
        <span className="flex-1">{result.error}</span>
        {sendLost ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={buttonClasses}
          >
            Reload
          </button>
        ) : null}
      </div>
    ) : (
      <p
        role="status"
        className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
      >
        {[
          `Sent ${result.sent} of ${result.sent + result.failed}`,
          result.skippedNoEmail > 0
            ? `${result.skippedNoEmail} skipped (no email)`
            : null,
          result.failed > 0 ? `${result.failed} need attention` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    );

  const sorting = table.state.sorting;
  const sortChoice: SortChoice | null =
    sorting.length === 0
      ? "default"
      : sorting[0]?.id === LAST_NAME_COLUMN
        ? "last_name"
        : null;

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
          disabled={selectedCount === 0 || isSending || isSaving || sendLost}
          onClick={() =>
            setConfirm({
              mode: "selected",
              ids: selectedIds,
              sendable: selectedCount,
              emails: countEmails(selectedIds),
              skipped: 0,
              replacedLinks: linkedCount(selectedIds),
            })
          }
          className={selectedCount > 0 ? primaryButtonClasses : buttonClasses}
        >
          Request addresses{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </button>
        <button
          type="button"
          disabled={rows.length === 0 || isSending || isSaving || sendLost}
          onClick={() => {
            // All VISIBLE rows (search-filtered), never the whole book. The
            // no-email ones are included so the server reports them skipped.
            // slice: the action caps at 1000 ids per request.
            const targets = (
              attentionIds
                ? rows.filter((row) => row.needsAttention)
                : rows
            ).slice(0, 1000);
            const sendable = targets.filter((row) => emailCount(row.values) > 0).length;
            setConfirm({
              mode: attentionIds ? "attention" : "shown",
              ids: targets.map((row) => row.id),
              sendable,
              emails: countEmails(targets.map((row) => row.id)),
              skipped: targets.length - sendable,
              replacedLinks: linkedCount(targets.map((row) => row.id)),
            });
          }}
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
        {attentionCount > 0 || attentionIds ? (
          <button
            type="button"
            aria-pressed={attentionIds !== null}
            onClick={() => setAttentionIds(attentionIds ? null : attentionSnapshot())}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
              attentionIds
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-secondary"
            }`}
          >
            Needs attention ({attentionCount})
          </button>
        ) : null}
        <span className="flex-1" />
        <Menu.Root>
          <Menu.Trigger className={buttonClasses}>
            {sortChoice === "last_name" ? "Sort: Last name" : "Sort"}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner
              sideOffset={6}
              align="end"
              className="z-50 outline-none"
            >
              <Menu.Popup className="min-w-44 rounded-lg border border-border bg-card p-1 text-sm text-foreground shadow-md outline-none">
                <Menu.RadioGroup
                  value={sortChoice}
                  onValueChange={(value: SortChoice) =>
                    table.setSorting(
                      value === "last_name"
                        ? [{ id: LAST_NAME_COLUMN, desc: false }]
                        : [],
                    )
                  }
                >
                  {(
                    [
                      ["default", "First name"],
                      ["last_name", "Last name"],
                    ] as const
                  ).map(([value, label]) => (
                    <Menu.RadioItem
                      key={value}
                      value={value}
                      className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-highlighted:bg-muted"
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-4 items-center justify-center"
                      >
                        <Menu.RadioItemIndicator className="size-1.5 rounded-full bg-foreground" />
                      </span>
                      {label}
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
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
            Send{" "}
            <strong>
              {confirm.emails} {confirm.emails === 1 ? "email" : "emails"}
            </strong>{" "}
            to{" "}
            <strong>
              {confirm.mode === "shown"
                ? `the ${confirm.sendable} ${confirm.sendable === 1 ? "contact" : "contacts"} shown`
                : confirm.mode === "attention"
                  ? `the ${confirm.sendable} shown that still ${confirm.sendable === 1 ? "needs" : "need"} attention`
                  : `${confirm.sendable} ${confirm.sendable === 1 ? "contact" : "contacts"}`}
            </strong>
            {confirm.skipped > 0 ? (
              <> ({confirm.skipped} will be skipped: no email)</>
            ) : null}
            ? Each person gets their own update link that expires in 30 days.
            {confirm.replacedLinks > 0 ? (
              <>
                {" "}
                <strong>
                  {confirm.replacedLinks} already{" "}
                  {confirm.replacedLinks === 1 ? "has a link" : "have a link"}
                </strong>
                , which gets replaced once the new email arrives.
              </>
            ) : null}
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
                  const answers = row.original.answers;
                  const answersOpen = answers !== null && answersId === row.id;
                  const shared = {
                    row,
                    cells: row.getVisibleCells(),
                    isSelected: row.getIsSelected(),
                    setRef: (el: HTMLTableRowElement | null) => {
                      if (el) rowRefs.current.set(row.id, el);
                      else rowRefs.current.delete(row.id);
                    },
                    answersOpen,
                    onToggleAnswers: () =>
                      setAnswersId(answersOpen ? null : row.id),
                  };
                  const view = editing?.id === row.id ? (
                    <EditingRow
                      key={row.id}
                      {...shared}
                      isSaving={isSaving}
                      canCancel={!isSaving || Boolean(editing.stalled)}
                      onSave={(draft, household) => saveEdit(row, draft, household)}
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
                      names={
                        saved?.id === row.id && saved.rows === rows
                          ? (saved.names ?? row.original.names)
                          : row.original.names
                      }
                      isActive={row.id === activeRowId}
                      focusOnMount={row.id === refocusId}
                      onRefocused={() => setRefocusId(null)}
                      onFocusRow={() => setCursorId(row.id)}
                      onEdit={() => startEdit(row)}
                      onKeyDown={(event) => onRowKeyDown(event, row, index)}
                    />
                  );
                  return (
                    <Fragment key={row.id}>
                      {view}
                      {answersOpen ? (
                        <AnswersRow
                          answers={answers}
                          name={row.original.names.fullName}
                          colSpan={shared.cells.length}
                          onClose={() => {
                            setAnswersId(null);
                            focusRow(row.id);
                          }}
                        />
                      ) : null}
                    </Fragment>
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
            const { values, names } = row.original;
            const name = sheetName(names);
            const place = [values.address_line1, values.city]
              .filter(Boolean)
              .join(", ");
            const emails = [values.email, values.partner_email]
              .filter(Boolean)
              .join(" · ");
            const answers = row.original.answers;
            return (
              <li
                key={row.id}
                className={`px-4 py-2 ${answers ? "bg-secondary/40" : ""}`}
              >
                <div className="flex min-h-14 items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${names.fullName}`}
                    checked={row.getIsSelected()}
                    disabled={!row.getCanSelect()}
                    onChange={() => row.toggleSelected()}
                    className="size-5 shrink-0 accent-primary disabled:opacity-40"
                  />
                  <Link
                    href={`/dashboard/contacts/${row.id}`}
                    className="min-w-0 flex-1"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                        {name.split ? null : <UnsplitDot />}
                        <span className="flex min-w-0 items-baseline">
                          <HouseholdLabel line={name.line} kids={name.kids} />
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        {answers ? (
                          <span className={`${chipBase} ${answersChipClasses}`}>
                            Two answers
                          </span>
                        ) : null}
                        <StatusChips row={row.original} />
                      </span>
                    </span>
                    {emails ? (
                      <span className="mt-0.5 block text-xs break-all text-foreground/70">
                        {emails}
                      </span>
                    ) : null}
                    <span className="block truncate text-xs text-muted-foreground">
                      {place || "No address yet"}
                    </span>
                  </Link>
                </div>
                {answers ? <PhoneAnswers answers={answers} /> : null}
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
  answersOpen: boolean;
  onToggleAnswers: () => void;
};

function SelectCell({ row, isSelected }: Pick<RowProps, "row" | "isSelected">) {
  return (
    <td className={cellClasses}>
      <input
        type="checkbox"
        // The row is the Tab stop; Space on the row toggles this.
        tabIndex={-1}
        aria-label={`Select ${row.original.names.fullName}`}
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
  answersOpen,
  onToggleAnswers,
}: Pick<RowProps, "row" | "answersOpen" | "onToggleAnswers"> & {
  columnId: "status" | "updated";
}) {
  return columnId === "status" ? (
    <td className={`${cellClasses} py-1`}>
      <span className="flex flex-col items-start gap-1">
        {row.original.answers ? (
          <button
            type="button"
            aria-expanded={answersOpen}
            onClick={onToggleAnswers}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape" && answersOpen) {
                event.preventDefault();
                // Else the row's Escape handler also cancels an open edit.
                event.stopPropagation();
                onToggleAnswers();
              }
            }}
            className={`${chipBase} ${answersChipClasses} cursor-pointer gap-1`}
          >
            Two answers
            <span aria-hidden="true">{answersOpen ? "▴" : "▾"}</span>
          </button>
        ) : null}
        <StatusChips row={row.original} />
      </span>
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
  answersOpen,
  onToggleAnswers,
  values,
  names,
  isActive,
  focusOnMount,
  onRefocused,
  onFocusRow,
  onEdit,
  onKeyDown,
}: RowProps & {
  values: SheetValues;
  names: StoredNames;
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
          return (
            <StaticCell
              key={cell.id}
              row={row}
              columnId={id}
              answersOpen={answersOpen}
              onToggleAnswers={onToggleAnswers}
            />
          );
        }
        if (id === NAME_COLUMN) {
          const name = sheetName(names);
          return (
            <td key={cell.id} className={cellClasses}>
              <span className="flex min-w-0 items-center gap-1.5">
                {name.split ? null : <UnsplitDot />}
                <Link
                  href={`/dashboard/contacts/${row.id}`}
                  tabIndex={-1}
                  className="truncate font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {name.line}
                </Link>
                {name.kids ? (
                  <span className="shrink-0 text-muted-foreground">
                    · {name.kids}
                  </span>
                ) : null}
              </span>
            </td>
          );
        }
        if (field?.field === "email") {
          return (
            <td key={cell.id} className={`${cellClasses} py-1 text-foreground/80`}>
              <span className="block truncate">
                {values.email || <span className="text-muted-foreground/50">—</span>}
              </span>
              {values.partner_email ? (
                <span className="block truncate text-muted-foreground">
                  {values.partner_email}
                </span>
              ) : null}
            </td>
          );
        }
        if (field) {
          const value = values[field.field];
          return (
            <td
              key={cell.id}
              className={`${cellClasses} truncate text-foreground/80`}
            >
              {value || <span className="text-muted-foreground/50">—</span>}
            </td>
          );
        }
        return (
          <td key={cell.id} className={`${cellClasses} text-right`}>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Edit ${names.fullName}`}
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
  answersOpen,
  onToggleAnswers,
  isSaving,
  canCancel,
  onSave,
  onCancel,
}: RowProps & {
  isSaving: boolean;
  canCancel: boolean;
  onSave: (
    draft: Partial<SheetValues>,
    household: { draft: HouseholdDraft; base: StoredNames } | null,
  ) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Partial<SheetValues>>({});
  // Null until the panel first opens; closing it keeps the draft.
  const [household, setHousehold] = useState<HouseholdDraft | null>(null);
  const [householdBase, setHouseholdBase] = useState<StoredNames | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [householdErrors, setHouseholdErrors] =
    useState<HouseholdFieldErrors | null>(null);
  const { values, names } = row.original;
  const firstCellId = cells.find(
    (cell) => cell.column.id === NAME_COLUMN || FIELD_BY_ID.has(cell.column.id),
  )?.column.id;

  function save() {
    const base = householdBase ?? names;
    if (household && householdEdited(base, household)) {
      const result = validateHousehold(draftToValues(household));
      if (!result.ok) {
        setHouseholdErrors(result.errors);
        setPanelOpen(true);
        return;
      }
    }
    onSave(draft, household && { draft: household, base });
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      save();
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
          return (
            <StaticCell
              key={cell.id}
              row={row}
              columnId={id}
              answersOpen={answersOpen}
              onToggleAnswers={onToggleAnswers}
            />
          );
        }
        if (id === NAME_COLUMN) {
          return (
            <td key={cell.id} className={`${cellClasses} px-1`}>
              <HouseholdNameCell
                names={names}
                draft={household}
                onOpen={() => {
                  if (household) return;
                  setHousehold(draftFromNames(names));
                  setHouseholdBase(names);
                }}
                onDraftChange={(next) => {
                  setHousehold(next);
                  if (householdErrors) {
                    const result = validateHousehold(draftToValues(next));
                    setHouseholdErrors(result.ok ? null : result.errors);
                  }
                }}
                open={panelOpen}
                onOpenChange={setPanelOpen}
                errors={householdErrors}
                isSaving={isSaving}
                onSave={save}
                autoFocus={id === firstCellId}
              />
            </td>
          );
        }
        if (field?.field === "email") {
          return (
            <td key={cell.id} className={`${cellClasses} px-1 py-1`}>
              <span className="flex flex-col gap-1">
                {(
                  [
                    ["email", "Email"],
                    ["partner_email", "Partner email"],
                  ] as const
                ).map(([name, label]) => (
                  <input
                    key={name}
                    data-cell-input={name === "email" ? true : undefined}
                    aria-label={label}
                    placeholder={label}
                    maxLength={field.maxLength}
                    autoFocus={name === "email" && id === firstCellId}
                    readOnly={isSaving}
                    value={draft[name] ?? values[name]}
                    onChange={(event) =>
                      setDraft({ ...draft, [name]: event.target.value })
                    }
                    onKeyDown={onInputKeyDown}
                    className={`${cellInputClasses} placeholder:text-muted-foreground/60`}
                  />
                ))}
              </span>
            </td>
          );
        }
        if (field) {
          return (
            <td key={cell.id} className={`${cellClasses} px-1`}>
              <input
                data-cell-input
                aria-label={field.label}
                maxLength={field.maxLength}
                autoFocus={id === firstCellId}
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
                onClick={save}
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

function useResolveAnswer(submissionId: string, onResolved: () => void) {
  const [isResolving, startResolve] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function choose(choice: "keep" | "use") {
    setError(null);
    startResolve(async () => {
      const formData = new FormData();
      formData.set("id", submissionId);
      let result: ReviewActionState;
      try {
        result = await (choice === "use" ? approveMerge : reject)({}, formData);
      } catch {
        result = { error: SAVE_FAILED };
      }
      if (result.error) setError(result.error);
      else onResolved();
    });
  }
  return { isResolving, error, choose };
}

function answerLabels(answers: TwoAnswers) {
  const saved = answers.saved.name;
  const incoming = answers.incoming.name;
  return {
    savedHeading: saved ? `${saved} · saved now` : "Saved now",
    keep: saved ? `Keep ${saved}'s` : "Keep saved",
    incomingHeading: incoming ?? "New answer",
    use: incoming ? `Use ${incoming}'s` : "Use new answer",
  };
}

function AnswerLines({ side }: { side: AnswerSide }) {
  return (
    <>
      {side.lines.map((line, i) => (
        <span key={i} className={i === 0 ? undefined : "block"}>
          {line.label ? (
            <span className="text-muted-foreground">{line.label}: </span>
          ) : null}
          {line.parts.length === 0 ? (
            <span className="text-muted-foreground">No address</span>
          ) : (
            line.parts.map((part, j) => (
              <Fragment key={j}>
                {part.changed ? (
                  <mark className="rounded bg-amber-100 px-0.5 text-foreground dark:bg-amber-900/60">
                    {part.text}
                  </mark>
                ) : (
                  part.text
                )}
              </Fragment>
            ))
          )}
        </span>
      ))}
    </>
  );
}

const resolveErrorClasses = "text-sm text-red-700 dark:text-red-300";

function AnswersRow({
  answers,
  name,
  colSpan,
  onClose,
}: {
  answers: TwoAnswers;
  name: string;
  colSpan: number;
  onClose: () => void;
}) {
  const { isResolving, error, choose } = useResolveAnswer(
    answers.submissionId,
    onClose,
  );
  const labels = answerLabels(answers);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);
  return (
    <tr className="[&>td]:bg-secondary/40">
      <td colSpan={colSpan} className="border-b border-border/60 px-12 pt-1 pb-4">
        <div
          ref={panelRef}
          role="region"
          aria-label={`Two answers for ${name}`}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !isResolving) {
              event.preventDefault();
              onClose();
            }
          }}
          className="flex max-w-3xl flex-col gap-2 outline-none"
        >
          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-2 rounded-xl border-2 border-primary bg-card p-3.5">
              <span className="text-xs font-semibold tracking-wide text-primary uppercase">
                {labels.savedHeading}
              </span>
              <span className="font-serif text-[15px] leading-snug text-foreground">
                <AnswerLines side={answers.saved} />
              </span>
              <button
                type="button"
                disabled={isResolving}
                onClick={() => choose("keep")}
                className={`${buttonClasses} mt-auto h-9 self-start`}
              >
                {labels.keep}
              </button>
            </div>
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5">
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {labels.incomingHeading}
              </span>
              <span className="font-serif text-[15px] leading-snug text-foreground">
                <AnswerLines side={answers.incoming} />
              </span>
              <button
                type="button"
                disabled={isResolving}
                onClick={() => choose("use")}
                className={`${primaryButtonClasses} mt-auto h-9 self-start`}
              >
                {labels.use}
              </button>
            </div>
          </div>
          {error ? (
            <p role="alert" className={resolveErrorClasses}>
              {error}
            </p>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function PhoneAnswers({ answers }: { answers: TwoAnswers }) {
  const { isResolving, error, choose } = useResolveAnswer(
    answers.submissionId,
    () => {},
  );
  const labels = answerLabels(answers);
  return (
    <div className="mt-2 flex flex-col gap-2">
      {(
        [
          ["keep", answers.saved, labels.keep, buttonClasses],
          ["use", answers.incoming, labels.use, primaryButtonClasses],
        ] as const
      ).map(([choice, side, label, classes]) => (
        <div
          key={choice}
          className="flex flex-col gap-1.5 rounded-lg bg-card p-2.5 text-sm text-foreground"
        >
          <span>
            <strong className="font-semibold">
              {choice === "keep"
                ? `${answers.saved.name ?? "Saved"} (saved):`
                : `${answers.incoming.name ?? "New answer"}:`}
            </strong>{" "}
            <AnswerLines side={side} />
          </span>
          <button
            type="button"
            disabled={isResolving}
            onClick={() => choose(choice)}
            className={`${classes} h-11 justify-center text-sm`}
          >
            {label}
          </button>
        </div>
      ))}
      {error ? (
        <p role="alert" className={resolveErrorClasses}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
