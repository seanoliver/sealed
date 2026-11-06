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
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { type ContactFormState } from "@/app/dashboard/contacts/actions";
import {
  AddressFields,
  type AddressFieldsHandle,
  type AddressPreview,
} from "@/components/address-fields";
import { Field, FormError, NotesField } from "@/components/contact-form";
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
import { cameFromPath } from "@/components/navigation-history";
import { cn } from "@/lib/utils";
import { type ContactFormValues } from "@/lib/validation/contact";
import { type HouseholdValues } from "@/lib/validation/household";

const CONTACTS_PATH = "/dashboard";
const initialState: ContactFormState = {};
const ENABLED_NAMES = { partner_name: true, kids_names: true };
// Fields with no line on the envelope, which still count as a change.
const DETAIL_KEYS = ["email", "partner_email", "birthday", "notes"];

type ContactEditorProps = {
  action: (state: ContactFormState, formData: FormData) => Promise<ContactFormState>;
  contactId: string;
  version: string;
  /** The name printed in the envelope's corner. */
  from: string;
  defaults: ContactFormValues;
  household: HouseholdValues;
  senderCountry: string;
  legacyCountry: string | null;
  heading: ReactNode;
  /** Page sections after the form, outside it so their own forms aren't nested. */
  children: ReactNode;
};

/** The owner's contact page: the address as an editable envelope, saved with the details in one form. */
export function ContactEditor({
  action,
  contactId,
  version,
  from,
  defaults,
  household,
  senderCountry,
  legacyCountry,
  heading,
  children,
}: ContactEditorProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const addressRef = useRef<AddressFieldsHandle>(null);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const leaveAfterSave = useRef(false);

  const [state, formAction, pending] = useActionState(action, initialState);
  const { changed, rebase } = useFormChanges(formRef);
  const editing = useEnvelopeEditing({ formRef, household, state });
  const { open, draft, setOpen } = editing;
  // React 19 resets uncontrolled inputs after an action; the echoed values restore them.
  const v = state.values ?? defaults;
  const dirty = changed.size > 0;

  function goToContacts() {
    // History keeps the list's search and scroll position; a fresh navigation would lose both.
    if (cameFromPath(CONTACTS_PATH)) router.back();
    else router.push(CONTACTS_PATH);
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
          <Field name="email" label="Email" value={v.email} type="email" maxLength={320} />
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
                dirty ? "max-sm:ml-auto" : "max-sm:flex-1",
              )}
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
            {dirty ? (
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
        <h1 className="font-serif text-2xl leading-tight text-foreground">{heading}</h1>

        <input type="hidden" name="id" value={contactId} />
        <input type="hidden" name="version" value={version} />

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
          prefillCountry={false}
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
        <p className="mt-1 text-sm text-muted-foreground">Your changes to this contact aren&apos;t saved yet.</p>
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
            Save and go back
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
