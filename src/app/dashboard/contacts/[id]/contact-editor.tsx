"use client";

import {
  useActionState,
  useEffect,
  useEffectEvent,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { unstable_isUnrecognizedActionError, unstable_rethrow, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { type ContactFormState } from "@/app/dashboard/contacts/actions";
import {
  AddressFields,
  type AddressFieldsHandle,
  type AddressPreview,
} from "@/components/address-fields";
import { Field, FormError, NotesField, PersonEmailFields } from "@/components/contact-form";
import {
  changedLineCount,
  EnvelopeCard,
  EnvelopeCountry,
  openFields,
  revealPostcode,
  useEnvelopeEditing,
  useFormChanges,
} from "@/components/envelope-card";
import {
  envelopeInputClasses,
  envelopeLabelClasses,
  HouseholdInputs,
  pruneDraft,
} from "@/components/envelope-names";
import { envelopeRows } from "@/components/envelope-rows";
import { contactsListReturn } from "@/components/contacts-list-memory";
import { cn } from "@/lib/utils";
import { CONTACT_FIELDS, type ContactFormValues } from "@/lib/validation/contact";
import { type HouseholdValues } from "@/lib/validation/household";

const CONTACTS_PATH = "/dashboard";
const initialState: ContactFormState = {};
const CONNECTION_DROPPED = "The connection dropped. Tap again.";
const PAGE_OUT_OF_DATE = "This page is out of date. Copy anything you need, then reload.";
const SAVE_FAILED = "Something went wrong. Please try again.";

function saveFailedMessage(error: unknown): string {
  if (unstable_isUnrecognizedActionError(error)) return PAGE_OUT_OF_DATE;
  return error instanceof TypeError || !navigator.onLine ? CONNECTION_DROPPED : SAVE_FAILED;
}

function saveFailed(error: unknown, formData: FormData): ContactFormState {
  return {
    error: saveFailedMessage(error),
    values: Object.fromEntries(
      CONTACT_FIELDS.map((field) => [field, String(formData.get(field) ?? "")]),
    ) as ContactFormValues,
  };
}
const NOTHING_CHANGED: ReadonlySet<string> = new Set();
const ENABLED_NAMES = { partner_name: true, kids_names: true };
const DETAIL_KEYS = [
  "email",
  "personal_email",
  "partner_email",
  "partner_personal_email",
  "birthday",
  "notes",
];

type ContactEditorProps = {
  action: (state: ContactFormState, formData: FormData) => Promise<ContactFormState>;
  existing?: { contactId: string; version: string };
  from: string;
  defaults: ContactFormValues;
  household: HouseholdValues;
  senderCountry: string;
  legacyCountry: string | null;
  heading: ReactNode;
  intro?: ReactNode;
  /** Page sections after the form, outside it so their own forms aren't nested. */
  children?: ReactNode;
};

export function ContactEditor({
  action,
  existing,
  from,
  defaults,
  household,
  senderCountry,
  legacyCountry,
  heading,
  intro,
  children,
}: ContactEditorProps) {
  const creating = existing === undefined;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const addressRef = useRef<AddressFieldsHandle>(null);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const leaveAfterSave = useRef(false);

  const saveToken = useRef<string | null>(null);
  const [state, formAction, pending] = useActionState(
    async (previous: ContactFormState, formData: FormData) => {
      try {
        saveToken.current ??= typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null;
        if (saveToken.current) formData.set("save_token", saveToken.current);
        const result = await action(previous, formData);
        if (result.saved) saveToken.current = null;
        return result;
      } catch (error) {
        unstable_rethrow(error);
        return saveFailed(error, formData);
      }
    },
    initialState,
  );
  const formChanges = useFormChanges(formRef);
  const { rebase } = formChanges;
  const changed = creating ? NOTHING_CHANGED : formChanges.changed;
  const dirty = formChanges.changed.size > 0;
  const editing = useEnvelopeEditing({
    formRef,
    household,
    state,
    startOpen: creating ? { kind: "names" } : null,
  });
  const { open, draft, setOpen } = editing;
  // React 19 resets uncontrolled inputs after an action; the echoed values restore them.
  const v = state.values ?? defaults;

  function goToContacts() {
    const { url, restore } = contactsListReturn();
    router.push(url, { scroll: !restore });
  }

  function onBack(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    if (dirty) leaveDialog.current?.showModal();
    else goToContacts();
  }

  const onResult = useEffectEvent(() => {
    if (state.saved) {
      rebase();
      if (leaveAfterSave.current) goToContacts();
    }
    leaveAfterSave.current = false;
    if (state.error) formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (state.fieldErrors?.postal_code) revealPostcode(editing);
    else if (state.fieldErrors?.country_code) setOpen({ kind: "country" });
  });
  useEffect(() => {
    if (state !== initialState) onResult();
  }, [state]);

  const layout = ({ fields, preview }: { fields: ReactNode; preview: AddressPreview }) => {
    const rows = envelopeRows(preview, open?.kind === "address" ? open : null);
    const count = changedLineCount(rows, changed) + DETAIL_KEYS.filter((key) => changed.has(key)).length;

    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-2 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:self-start">
          <EnvelopeCard
            editing={editing}
            addressRef={addressRef}
            fields={fields}
            preview={preview}
            from={from}
            changed={changed}
            enabled={ENABLED_NAMES}
            recipient="owner"
            errors={state.fieldErrors}
            scrollClassName="scroll-mt-14 lg:scroll-mt-3"
          />
          <EnvelopeCountry
            editing={editing}
            fields={fields}
            preview={preview}
            changed={changed}
            legacyCountry={legacyCountry}
            senderCountry={senderCountry}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
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
          <NotesField value={v.notes} />

          <div
            className={cn(
              "flex items-center gap-3",
              dirty &&
                "max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-4 max-sm:-mb-4 max-sm:rounded-b-xl max-sm:border-t max-sm:border-border max-sm:bg-card max-sm:px-4 max-sm:py-2.5",
            )}
          >
            <button
              type="submit"
              disabled={pending}
              className={cn(
                "h-10 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50 max-sm:order-last",
                dirty && !creating ? "max-sm:ml-auto" : "max-sm:flex-1",
              )}
            >
              {creating ? (pending ? "Adding…" : "Add contact") : pending ? "Saving…" : "Save changes"}
            </button>
            {dirty && !creating ? (
              <span className="text-sm font-medium text-foreground">
                {count > 0 ? `${count} change${count === 1 ? "" : "s"}` : "Unsaved changes"}
              </span>
            ) : null}
            {state.saved && !dirty && !pending ? (
              <span role="status" className="text-sm font-medium text-green-800 dark:text-green-200">
                Saved.
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-10 sm:pt-6 lg:max-w-4xl">
      <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-background px-2 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
        <Link
          href={CONTACTS_PATH}
          onClick={onBack}
          className="inline-flex h-11 items-center gap-1 pr-3 text-sm font-semibold text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Contacts
        </Link>
      </div>

      <form
        ref={formRef}
        action={formAction}
        onSubmit={(event) => {
          if (addressRef.current?.validate() !== false) return;
          event.preventDefault();
          leaveAfterSave.current = false;
          revealPostcode(editing);
          requestAnimationFrame(() => addressRef.current?.validate());
        }}
        className="mt-4 flex scroll-mt-14 flex-col gap-5 rounded-xl border border-border bg-card p-4 shadow-sm sm:mt-2 sm:p-8"
      >
        {state.error ? <FormError message={state.error} /> : null}
        <div>
          <h1 className="font-serif text-2xl leading-tight text-foreground">{heading}</h1>
          {intro ? <p className="mt-1 text-sm text-pretty text-muted-foreground">{intro}</p> : null}
        </div>

        {existing ? (
          <>
            <input type="hidden" name="id" value={existing.contactId} />
            <input type="hidden" name="version" value={existing.version} />
          </>
        ) : null}

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
          styles={{ input: envelopeInputClasses, label: envelopeLabelClasses }}
          errors={{
            postal_code: state.fieldErrors?.postal_code,
            country_code: state.fieldErrors?.country_code,
          }}
          errorsKey={state}
          preview={layout}
          focus={open?.kind === "address" || open?.kind === "country" ? new Set(openFields(open)) : null}
          handleRef={addressRef}
          prefillCountry={creating}
          postcodeFirstIn="US"
        />
        <HouseholdInputs draft={pruneDraft(draft)} enabled={ENABLED_NAMES} />
      </form>

      {children}

      <dialog
        ref={leaveDialog}
        aria-labelledby="leave-title"
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-border bg-card p-5 text-foreground shadow-lg backdrop:bg-foreground/40"
      >
        <h2 id="leave-title" className="font-serif text-lg leading-tight">
          Leave without saving?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {creating ? "This contact isn't added yet." : "Your changes to this contact aren't saved yet."}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              leaveDialog.current?.close();
              // A browser-blocked submit fires no event, so it must not leave the flag set.
              if (!formRef.current?.reportValidity()) return;
              leaveAfterSave.current = true;
              formRef.current.requestSubmit();
            }}
            className="h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
          >
            {creating ? "Add and go back" : "Save and go back"}
          </button>
          <button
            type="button"
            onClick={() => {
              leaveDialog.current?.close();
              goToContacts();
            }}
            className="h-11 rounded-lg border border-input text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Discard changes
          </button>
          <button
            type="button"
            onClick={() => leaveDialog.current?.close()}
            className="h-11 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Keep editing
          </button>
        </div>
      </dialog>
    </main>
  );
}
