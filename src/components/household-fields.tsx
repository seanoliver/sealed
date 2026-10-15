"use client";

import { useRef, useState, type ReactNode, type Ref } from "react";
import { Plus, X } from "lucide-react";
import { type EnabledFields } from "@/components/recipient-fields";
import { inputClasses, labelClasses } from "@/components/recipient-field-styles";
import { cn } from "@/lib/utils";
import {
  KIDS_MAX,
  NAME_MAX,
  type HouseholdFieldErrors,
  type HouseholdValues,
} from "@/lib/validation/household";

type Row = { first: string; last: string; lastEdited: boolean };

type HouseholdFieldsProps = {
  defaults: HouseholdValues;
  enabled: Pick<EnabledFields, "partner_name" | "kids_names">;
  errors?: HouseholdFieldErrors;
  audience?: "recipient" | "owner";
};

const errorClasses = "text-xs text-red-700 dark:text-red-300";
const invalidClasses = "border-red-400 dark:border-red-800";
const addButtonClasses =
  "inline-flex h-9 items-center gap-1.5 self-start rounded-lg px-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent";

function toRow(row: { first: string; last: string }, familyLast: string): Row {
  return { ...row, lastEdited: row.last !== familyLast };
}

type NameInputProps = {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  following?: boolean;
  inputRef?: Ref<HTMLInputElement>;
};

function NameInput({
  id,
  name,
  label,
  value,
  onChange,
  error,
  following = false,
  inputRef,
}: NameInputProps) {
  return (
    <input
      ref={inputRef}
      id={id}
      name={name}
      type="text"
      aria-label={label}
      placeholder={label}
      maxLength={NAME_MAX}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className={cn(
        inputClasses,
        "min-w-0",
        following && "text-muted-foreground",
        error && invalidClasses,
      )}
    />
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} className={errorClasses}>
      {message}
    </p>
  );
}

type PersonRowProps = {
  idPrefix: string;
  label: string;
  firstName: string;
  lastName: string;
  row: Row;
  familyLast: string;
  onChange: (row: Row) => void;
  onRemove: () => void;
  removeLabel: string;
  errors: { first?: string; last?: string };
  hint?: ReactNode;
  lastRef?: Ref<HTMLInputElement>;
};

function PersonRow({
  idPrefix,
  label,
  firstName,
  lastName,
  row,
  familyLast,
  onChange,
  onRemove,
  removeLabel,
  errors,
  hint,
  lastRef,
}: PersonRowProps) {
  const following = !row.lastEdited;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelClasses}>{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
        <NameInput
          id={`${idPrefix}_first`}
          name={firstName}
          label={`${label} first name`}
          value={row.first}
          onChange={(first) => onChange({ ...row, first })}
          error={errors.first}
        />
        <NameInput
          id={`${idPrefix}_last`}
          name={lastName}
          label={`${label} last name`}
          value={following ? familyLast : row.last}
          onChange={(last) => onChange({ ...row, last, lastEdited: true })}
          error={errors.last}
          following={following && familyLast !== ""}
          inputRef={lastRef}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <FieldError id={`${idPrefix}_first`} message={errors.first} />
      <FieldError id={`${idPrefix}_last`} message={errors.last} />
      {hint}
    </div>
  );
}

export function HouseholdFields({
  defaults,
  enabled,
  errors = {},
  audience = "recipient",
}: HouseholdFieldsProps) {
  const [firstName, setFirstName] = useState(defaults.first_name);
  const [lastName, setLastName] = useState(defaults.last_name);
  const [partner, setPartner] = useState<Row | null>(() =>
    defaults.partner ? toRow(defaults.partner, defaults.last_name) : null,
  );
  const [kids, setKids] = useState<Row[]>(() =>
    defaults.kids.map((kid) => toRow(kid, defaults.last_name)),
  );
  // Row keys survive removals so React keeps focus and input state aligned.
  const nextKey = useRef(defaults.kids.length);
  const [kidKeys, setKidKeys] = useState(() => defaults.kids.map((_, i) => i));
  const partnerLastRef = useRef<HTMLInputElement>(null);

  const blankRow: Row = { first: "", last: "", lastEdited: false };

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className={labelClasses}>
          {audience === "owner" ? "Name" : "Your name"}
        </span>
        <div className="grid grid-cols-2 gap-2">
          <NameInput
            id="first_name"
            name="first_name"
            label="First name"
            value={firstName}
            onChange={setFirstName}
            error={errors.first_name}
          />
          <NameInput
            id="last_name"
            name="last_name"
            label="Last name"
            value={lastName}
            onChange={setLastName}
            error={errors.last_name}
          />
        </div>
        <FieldError id="first_name" message={errors.first_name} />
        <FieldError id="last_name" message={errors.last_name} />
      </div>

      {enabled.partner_name ? (
        <input type="hidden" name="partner_section" value="1" />
      ) : null}
      {enabled.kids_names ? (
        <input type="hidden" name="kids_section" value="1" />
      ) : null}

      {enabled.partner_name && partner ? (
        <PersonRow
          idPrefix="partner"
          label="Partner"
          firstName="partner_first_name"
          lastName="partner_last_name"
          row={partner}
          familyLast={lastName}
          onChange={setPartner}
          onRemove={() => setPartner(null)}
          removeLabel="Remove partner"
          errors={{
            first: errors.partner_first_name,
            last: errors.partner_last_name,
          }}
          lastRef={partnerLastRef}
          hint={
            !partner.lastEdited && lastName !== "" ? (
              <p className="text-xs text-muted-foreground">
                {audience === "owner" ? "Same last name" : "Same last name as you"} ·{" "}
                <button
                  type="button"
                  onClick={() => {
                    setPartner({ ...partner, last: lastName, lastEdited: true });
                    partnerLastRef.current?.focus();
                  }}
                  className="font-medium text-foreground/80 underline underline-offset-2 hover:text-foreground"
                >
                  Change
                </button>
              </p>
            ) : null
          }
        />
      ) : null}

      {enabled.kids_names
        ? kids.map((kid, i) => (
            <PersonRow
              key={kidKeys[i]}
              idPrefix={`kid_${i}`}
              label={`Child ${i + 1}`}
              firstName="kid_first"
              lastName="kid_last"
              row={kid}
              familyLast={lastName}
              onChange={(row) =>
                setKids(kids.map((k, j) => (j === i ? row : k)))
              }
              onRemove={() => {
                setKids(kids.filter((_, j) => j !== i));
                setKidKeys(kidKeys.filter((_, j) => j !== i));
              }}
              removeLabel={`Remove child ${i + 1}`}
              errors={{
                first: errors[`kids.${i}.first`],
                last: errors[`kids.${i}.last`],
              }}
            />
          ))
        : null}

      {(enabled.partner_name && !partner) ||
      (enabled.kids_names && kids.length < KIDS_MAX) ? (
        <div className="-mt-2 flex flex-wrap gap-x-2">
          {enabled.partner_name && !partner ? (
            <button
              type="button"
              onClick={() => setPartner(blankRow)}
              className={addButtonClasses}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add partner
            </button>
          ) : null}
          {enabled.kids_names && kids.length < KIDS_MAX ? (
            <button
              type="button"
              onClick={() => {
                setKids([...kids, blankRow]);
                setKidKeys([...kidKeys, nextKey.current++]);
              }}
              className={addButtonClasses}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add a child
            </button>
          ) : null}
        </div>
      ) : null}
      <FieldError id="kids" message={errors.kids} />
    </>
  );
}
