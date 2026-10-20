"use client";

import { useActionState } from "react";
import { type ContactFormState } from "@/app/dashboard/contacts/actions";
import { HouseholdFields } from "@/components/household-fields";
import { type ContactFormValues } from "@/lib/validation/contact";
import { type HouseholdValues } from "@/lib/validation/household";

const initialState: ContactFormState = {};

const inputClasses =
  "h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-3 focus:ring-ring/25 ";
const labelClasses = "text-sm font-medium text-foreground";

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
}: ContactFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  // React 19 resets uncontrolled inputs to defaultValue after a form action
  // completes; on error the action echoes the submitted values back so the
  // reset restores what the user typed instead of wiping the form.
  const v = state.values ?? defaults;

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-5">
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
      <Field
        name="address_line1"
        label="Address line 1"
        value={v.address_line1}
        maxLength={200}
      />
      <Field
        name="address_line2"
        label="Address line 2"
        value={v.address_line2}
        maxLength={200}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field name="city" label="City" value={v.city} maxLength={120} />
        <Field
          name="state_region"
          label="State / region"
          value={v.state_region}
          maxLength={120}
        />
        <Field
          name="postal_code"
          label="Postal code"
          value={v.postal_code}
          maxLength={20}
        />
        <Field
          name="country"
          label="Country"
          value={v.country}
          maxLength={120}
        />
      </div>

      <div className="flex flex-col gap-1.5">
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
        className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50 "
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
