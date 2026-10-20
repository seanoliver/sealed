"use client";

import { useActionState, useRef } from "react";
import { type ContactFormState } from "@/app/dashboard/contacts/actions";
import { AddressFields, type AddressFieldsHandle } from "@/components/address-fields";
import { HouseholdFields } from "@/components/household-fields";
import { type ContactFormValues } from "@/lib/validation/contact";
import { type HouseholdValues } from "@/lib/validation/household";

const initialState: ContactFormState = {};

const inputClasses =
  "h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-3 focus:ring-ring/25 ";
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
};

function Field({
  name,
  label,
  value,
  type = "text",
  maxLength,
  hint,
  error,
}: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className={labelClasses}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        maxLength={maxLength}
        defaultValue={value}
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
      {state.error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {state.error}
        </div>
      ) : null}
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
        <Field
          name="email"
          label="Email"
          value={v.email}
          type="email"
          maxLength={320}
        />
        <Field
          name="partner_email"
          label="Partner email"
          value={v.partner_email}
          type="email"
          maxLength={320}
          hint="Optional. The partner gets their own update link."
          error={state.fieldErrors?.partner_email}
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
        prefillCountry={contactId === undefined}
      />

      <div className={`${column} flex flex-col gap-1.5`}>
        <label htmlFor="notes" className={labelClasses}>
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={2000}
          defaultValue={v.notes}
          className="rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-3 focus:ring-ring/25 "
        />
      </div>

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
