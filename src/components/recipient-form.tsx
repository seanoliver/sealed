"use client";

import { useActionState, useRef } from "react";
import { type AddressFieldsHandle } from "@/components/address-fields";
import {
  RecipientFields,
  type EnabledFields,
} from "@/components/recipient-fields";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { type TokenUpdateValues } from "@/lib/validation/contact";
import {
  type HouseholdFieldErrors,
  type HouseholdValues,
} from "@/lib/validation/household";

/**
 * Shared recipient-facing contact form, used by both unauthenticated
 * surfaces: /u/[token] (pre-filled update) and /b/[slug] (blank, write-only
 * self-add). Renders ONLY the fields the book enables — a disabled field is
 * absent from the DOM entirely, so it is never posted. There is no notes
 * field on this surface by design (owner-private).
 */

/**
 * Action state for both recipient forms. `values` echoes the submission back
 * on error: React 19 resets uncontrolled inputs to their defaultValue after
 * a form action completes, so without the echo a failed save would wipe the
 * user's input.
 */
export type RecipientFormState = {
  error?: string;
  values?: TokenUpdateValues;
  household?: HouseholdValues;
  fieldErrors?: HouseholdFieldErrors;
};

type RecipientFormProps = {
  /** Server action with the token/slug pre-bound server-side. */
  action: (
    state: RecipientFormState,
    formData: FormData,
  ) => Promise<RecipientFormState>;
  defaults: TokenUpdateValues;
  enabled: EnabledFields;
  submitLabel: string;
  pendingLabel: string;
  /** Optional helper copy under the email input (e.g. "Optional — ..."). */
  emailHint?: string;
  household: HouseholdValues;
  seenAt?: string;
  ownerName: string;
  senderCountry: string;
  legacyCountry?: string | null;
  requireStreet?: boolean;
};

export function RecipientForm({
  action,
  defaults,
  enabled,
  submitLabel,
  pendingLabel,
  emailHint,
  household,
  seenAt,
  ownerName,
  senderCountry,
  legacyCountry,
  requireStreet,
}: RecipientFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
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

      <RecipientFields
        defaults={v}
        enabled={enabled}
        emailHint={emailHint}
        household={{
          defaults: state.household ?? household,
          errors: state.fieldErrors,
        }}
        ownerName={ownerName}
        senderCountry={senderCountry}
        legacyCountry={legacyCountry}
        addressRef={address}
        errorsKey={state}
        requireStreet={requireStreet}
      />

      {seenAt === undefined ? null : (
        <input type="hidden" name="seen_at" value={seenAt} />
      )}
      <TurnstileWidget resetOn={state} />

      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50 "
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
