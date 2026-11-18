"use client";

import { useState } from "react";
import { isWorkEmail, type EmailKind } from "@/lib/email-kind";
import { type ContactFormValues } from "@/lib/validation/contact";

const inputClasses =
  "h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/25 ";
const labelClasses = "text-sm font-medium text-foreground";

type FieldProps = {
  name: keyof ContactFormValues;
  label: string;
  value: string;
  type?: "text" | "email" | "date";
  maxLength?: number;
  hint?: string;
  error?: string;
  labelTag?: string;
  onInput?: (value: string) => void;
};

export function Field({
  name,
  label,
  value,
  type = "text",
  maxLength,
  hint,
  error,
  labelTag,
  onInput,
}: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className={labelClasses}>
        {label}
        {labelTag ? (
          <span className="ml-1.5 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
            {labelTag}
          </span>
        ) : null}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        maxLength={maxLength}
        defaultValue={value}
        onInput={onInput ? (event) => onInput(event.currentTarget.value) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={`${inputClasses} ${error ? "border-red-400 dark:border-red-800" : ""}`}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${name}-error`} className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type PersonEmailProps = {
  fields: {
    email: "email" | "partner_email";
    personal: "personal_email" | "partner_personal_email";
    kind: "email_kind" | "partner_email_kind";
  };
  labels: { email: string; personal: string };
  values: ContactFormValues;
  stored: ContactFormValues;
  emailHint?: string;
  emailError?: string;
};

export function PersonEmailFields({
  fields,
  labels,
  values,
  stored,
  emailHint,
  emailError,
}: PersonEmailProps) {
  const [email, setEmail] = useState(values[fields.email]);
  const [personal, setPersonal] = useState(values[fields.personal]);
  const [kind, setKind] = useState(values[fields.kind] as EmailKind | "");
  const looksWork = isWorkEmail(email);
  const asks = isWorkEmail(email, { kind: kind === "" ? null : kind });
  const showAsk = email.trim() !== "" && personal.trim() === "";
  const emptied = stored[fields.email] !== "" && email.trim() === "" && personal.trim() !== "";
  return (
    <>
      <Field
        name={fields.email}
        label={labels.email}
        value={values[fields.email]}
        type="email"
        maxLength={320}
        hint={emailHint}
        error={emailError}
        onInput={(next) => {
          setEmail(next);
          setKind("");
        }}
      />
      <input type="hidden" name={fields.kind} value={kind} />
      {showAsk ? (
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={asks}
            onChange={(event) => {
              const ticked = event.target.checked;
              if (ticked === looksWork) setKind("");
              else setKind(ticked ? "work" : "personal");
            }}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="flex flex-col gap-0.5">
            Ask for a personal email
            <span className="text-xs text-muted-foreground">
              {looksWork
                ? "This looks like a work address. Untick it if it's the person's own domain."
                : "This looks like a personal address, so the invite page won't ask."}
            </span>
          </span>
        </label>
      ) : null}
      {emptied ? (
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name={`keep_${fields.personal}`}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="flex flex-col gap-0.5">
            Keep sending invites to {personal.trim()}
            <span className="text-xs text-muted-foreground">
              Clearing this email doesn&apos;t stop invites. To stop them, clear the personal email too.
            </span>
          </span>
        </label>
      ) : null}
      <Field
        name={fields.personal}
        label={labels.personal}
        value={values[fields.personal]}
        type="email"
        maxLength={320}
        labelTag={personal.trim() !== "" ? "Invites go here" : undefined}
        hint={
          values[fields.personal] !== ""
            ? "Changing or clearing this retires that person's current links."
            : "Optional. Invites go here instead of the email above."
        }
        onInput={setPersonal}
      />
    </>
  );
}

export function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      {message}
    </div>
  );
}

export function NotesField({ value, className }: { value: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor="notes" className={labelClasses}>
        Notes
      </label>
      <textarea
        id="notes"
        name="notes"
        rows={4}
        maxLength={2000}
        defaultValue={value}
        className="rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/25 "
      />
    </div>
  );
}
