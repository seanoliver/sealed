"use client";

import { useActionState, useRef, useState } from "react";
import { type ContactFormState } from "@/app/dashboard/contacts/actions";
import { AddressFields, type AddressFieldsHandle } from "@/components/address-fields";
import { HouseholdFields } from "@/components/household-fields";
import { isWorkEmail, type EmailKind } from "@/lib/email-kind";
import { type ContactFormValues } from "@/lib/validation/contact";
import { type HouseholdValues } from "@/lib/validation/household";

const initialState: ContactFormState = {};

const inputClasses =
  "h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/25 ";
const labelClasses = "text-sm font-medium text-foreground";
// The envelope preview's 17rem column plus its gap, so these fields line up with the address.
const column = "lg:mr-[18.5rem]";

type ContactFormProps = {
  action: (
    state: ContactFormState,
    formData: FormData,
  ) => Promise<ContactFormState>;
  defaults: ContactFormValues;
  household: HouseholdValues;
  /** Present on the edit page; posted as a hidden field. */
  contactId?: string;
  version?: string;
  submitLabel: string;
  senderCountry: string;
  legacyCountry?: string | null;
};

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

export function ContactForm({
  action,
  defaults,
  household,
  contactId,
  version,
  submitLabel,
  senderCountry,
  legacyCountry,
}: ContactFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const address = useRef<AddressFieldsHandle>(null);
  // React 19 resets uncontrolled inputs to defaultValue after a form action
  // completes; on error the action echoes the submitted values back so the
  // reset restores what the user typed instead of wiping the form.
  const v = state.values ?? defaults;

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (address.current?.validate() === false) event.preventDefault();
      }}
      className="mt-6 flex flex-col gap-5"
    >
      {state.error ? <FormError message={state.error} /> : null}
      {state.saved ? (
        <div
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
        >
          Saved.
        </div>
      ) : null}

      {contactId ? <input type="hidden" name="id" value={contactId} /> : null}
      {version ? <input type="hidden" name="version" value={version} /> : null}

      <div className={`flex flex-col gap-5 ${column}`}>
        <HouseholdFields
          defaults={state.household ?? household}
          enabled={{ partner_name: true, kids_names: true }}
          errors={state.fieldErrors}
          audience="owner"
        />
        <PersonEmailFields
          fields={{ email: "email", personal: "personal_email", kind: "email_kind" }}
          labels={{ email: "Email", personal: "Personal email" }}
          values={v}
          stored={defaults}
        />
        <PersonEmailFields
          fields={{
            email: "partner_email",
            personal: "partner_personal_email",
            kind: "partner_email_kind",
          }}
          labels={{ email: "Partner email", personal: "Partner's personal email" }}
          values={v}
          stored={defaults}
          emailHint="Optional. The partner gets their own update link."
          emailError={state.fieldErrors?.partner_email}
        />
        <Field name="birthday" label="Birthday" value={v.birthday} type="date" />
      </div>

      <AddressFields
        defaults={{
          address_line1: v.address_line1,
          address_line2: v.address_line2,
          district: v.district,
          city: v.city,
          state_region: v.state_region,
          postal_code: v.postal_code,
          country_code: v.country_code,
        }}
        legacyCountry={legacyCountry}
        senderCountry={senderCountry}
        audience={{ kind: "owner" }}
        styles={{ input: inputClasses, label: labelClasses }}
        errors={{
          postal_code: state.fieldErrors?.postal_code,
          country_code: state.fieldErrors?.country_code,
        }}
        preview="beside"
        handleRef={address}
        errorsKey={state}
        prefillCountry={contactId === undefined}
      />

      <NotesField value={v.notes} className={column} />

      <button
        type="submit"
        disabled={pending}
        className={`h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50 ${column}`}
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
