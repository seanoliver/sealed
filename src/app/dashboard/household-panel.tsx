"use client";

import { useId, useRef, type KeyboardEvent, type Ref } from "react";
import { Popover } from "@base-ui/react/popover";
import { Plus, X } from "lucide-react";
import {
  draftToValues,
  namesFromValues,
  sheetName,
  type HouseholdDraft,
  type PanelRow,
} from "@/lib/contacts-sheet";
import { cn } from "@/lib/utils";
import { type StoredNames } from "@/lib/names";
import {
  KIDS_MAX,
  NAME_MAX,
  type HouseholdFieldErrors,
} from "@/lib/validation/household";

const panelInputClasses =
  "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none read-only:opacity-60 focus:border-ring focus:ring-2 focus:ring-ring/25 aria-invalid:border-red-400 dark:aria-invalid:border-red-800";
const removeClasses =
  "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
const addClasses =
  "inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground";
const rowLabelClasses = "w-16 shrink-0 text-xs font-medium text-muted-foreground";

export function UnsplitDot() {
  return (
    <span
      title="Not split yet"
      className="inline-flex shrink-0 items-center"
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-amber-500"
      />
      <span className="sr-only">(not split yet)</span>
    </span>
  );
}

export function HouseholdLabel({
  line,
  kids,
}: {
  line: string;
  kids: string | null;
}) {
  return (
    <>
      <span className="truncate">{line}</span>
      {kids ? (
        <span className="shrink-0 pl-1 font-normal text-muted-foreground">
          · {kids}
        </span>
      ) : null}
    </>
  );
}

type PanelInputProps = {
  label: string;
  placeholder: "First" | "Last";
  value: string;
  onChange: (value: string) => void;
  error?: string;
  following?: boolean;
  readOnly: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
};

function PanelInput({
  label,
  placeholder,
  value,
  onChange,
  error,
  following = false,
  readOnly,
  onKeyDown,
  inputRef,
}: PanelInputProps) {
  const id = useId();
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <input
        ref={inputRef}
        aria-label={label}
        placeholder={placeholder}
        maxLength={NAME_MAX}
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(panelInputClasses, following && "text-muted-foreground")}
      />
      {error ? (
        <span
          id={`${id}-error`}
          className="text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}

type HouseholdNameCellProps = {
  names: StoredNames;
  draft: HouseholdDraft | null;
  onOpen: () => void;
  onDraftChange: (draft: HouseholdDraft) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  errors: HouseholdFieldErrors | null;
  isSaving: boolean;
  onSave: () => void;
  autoFocus: boolean;
};

export function HouseholdNameCell({
  names,
  draft,
  onOpen,
  onDraftChange,
  open,
  onOpenChange,
  errors,
  isSaving,
  onSave,
  autoFocus,
}: HouseholdNameCellProps) {
  const titleId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const shown = draft
    ? sheetName(namesFromValues(draftToValues(draft)))
    : sheetName(names);
  const split = sheetName(names).split;

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSave();
    }
  }

  const blankRow: PanelRow = { first: "", last: "", lastEdited: false };
  const setRow = (rows: PanelRow[], i: number, row: PanelRow) =>
    rows.map((r, j) => (j === i ? row : r));

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) onOpen();
        onOpenChange(next);
      }}
      modal="trap-focus"
    >
      <Popover.Trigger
        data-cell-input
        autoFocus={autoFocus}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-input bg-background px-1.5 text-left text-sm font-medium text-foreground outline-none hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 data-popup-open:border-ring"
      >
        {split || draft ? null : <UnsplitDot />}
        <span className="flex min-w-0 flex-1 items-baseline">
          <HouseholdLabel line={shown.line} kids={shown.kids} />
        </span>
        <span aria-hidden="true" className="shrink-0 text-[10px] text-muted-foreground">
          ▾
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 outline-none"
        >
          <Popover.Popup
            data-household-panel
            aria-labelledby={titleId}
            initialFocus={firstInputRef}
            onKeyDown={(event) => {
              // Esc closes only the panel; without this the row would also
              // see the key and cancel the whole edit.
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                event.stopPropagation();
                event.preventDefault();
                onOpenChange(false);
              }
            }}
            className="flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2.5 rounded-xl border border-border bg-card p-3 text-sm text-foreground shadow-lg outline-none"
          >
            <Popover.Title
              id={titleId}
              className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            >
              Household
            </Popover.Title>
            {split ? null : (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                Saved as one name:{" "}
                <span className="font-medium">
                  {[
                    names.fullName,
                    names.partnerName,
                    names.kidsNames ? `kids ${names.kidsNames}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                . Check the split below before saving.
              </p>
            )}
            {draft ? (
              <>
                <div className="flex items-start gap-2">
                  <span className={cn(rowLabelClasses, "pt-2")}>Contact</span>
                  <PanelInput
                    inputRef={firstInputRef}
                    label="Contact first name"
                    placeholder="First"
                    value={draft.first_name}
                    onChange={(first_name) => onDraftChange({ ...draft, first_name })}
                    error={errors?.first_name}
                    readOnly={isSaving}
                    onKeyDown={onInputKeyDown}
                  />
                  <PanelInput
                    label="Contact last name"
                    placeholder="Last"
                    value={draft.last_name}
                    onChange={(last_name) => onDraftChange({ ...draft, last_name })}
                    error={errors?.last_name}
                    readOnly={isSaving}
                    onKeyDown={onInputKeyDown}
                  />
                  <span className="size-8 shrink-0" />
                </div>

                {draft.partner ? (
                  <div className="flex items-start gap-2">
                    <span className={cn(rowLabelClasses, "pt-2")}>Partner</span>
                    <PanelInput
                      label="Partner first name"
                    placeholder="First"
                      value={draft.partner.first}
                      onChange={(first) =>
                        draft.partner &&
                        onDraftChange({ ...draft, partner: { ...draft.partner, first } })
                      }
                      error={errors?.partner_first_name}
                      readOnly={isSaving}
                      onKeyDown={onInputKeyDown}
                    />
                    <PanelInput
                      label="Partner last name"
                    placeholder="Last"
                      value={draft.partner.lastEdited ? draft.partner.last : draft.last_name}
                      following={!draft.partner.lastEdited}
                      onChange={(last) =>
                        draft.partner &&
                        onDraftChange({
                          ...draft,
                          partner: { ...draft.partner, last, lastEdited: true },
                        })
                      }
                      error={errors?.partner_last_name}
                      readOnly={isSaving}
                      onKeyDown={onInputKeyDown}
                    />
                    <button
                      type="button"
                      aria-label="Remove partner"
                      onClick={() => onDraftChange({ ...draft, partner: null })}
                      className={removeClasses}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}

                {draft.kids.map((kid, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={cn(rowLabelClasses, "pt-2")}>
                      {i === 0 ? "Kids" : ""}
                    </span>
                    <PanelInput
                      label={`Child ${i + 1} first name`}
                    placeholder="First"
                      value={kid.first}
                      onChange={(first) =>
                        onDraftChange({
                          ...draft,
                          kids: setRow(draft.kids, i, { ...kid, first }),
                        })
                      }
                      error={errors?.[`kids.${i}.first`]}
                      readOnly={isSaving}
                      onKeyDown={onInputKeyDown}
                    />
                    <PanelInput
                      label={`Child ${i + 1} last name`}
                    placeholder="Last"
                      value={kid.lastEdited ? kid.last : draft.last_name}
                      following={!kid.lastEdited}
                      onChange={(last) =>
                        onDraftChange({
                          ...draft,
                          kids: setRow(draft.kids, i, { ...kid, last, lastEdited: true }),
                        })
                      }
                      error={errors?.[`kids.${i}.last`]}
                      readOnly={isSaving}
                      onKeyDown={onInputKeyDown}
                    />
                    <button
                      type="button"
                      aria-label={`Remove child ${i + 1}`}
                      onClick={() =>
                        onDraftChange({
                          ...draft,
                          kids: draft.kids.filter((_, j) => j !== i),
                        })
                      }
                      className={removeClasses}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}

                <div className="flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
                  {draft.partner ? null : (
                    <button
                      type="button"
                      onClick={() => onDraftChange({ ...draft, partner: blankRow })}
                      className={addClasses}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      Add partner
                    </button>
                  )}
                  {draft.kids.length < KIDS_MAX ? (
                    <button
                      type="button"
                      onClick={() =>
                        onDraftChange({ ...draft, kids: [...draft.kids, blankRow] })
                      }
                      className={addClasses}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      Add a child
                    </button>
                  ) : null}
                  <span className="flex-1" />
                  <Popover.Close className="h-8 rounded-md border border-input px-3 text-xs font-medium hover:bg-muted">
                    Done
                  </Popover.Close>
                </div>
              </>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
