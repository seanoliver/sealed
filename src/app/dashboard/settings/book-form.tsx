"use client";

import { useActionState, useState } from "react";
import { CountrySelect } from "@/components/country-select";
import { InvitePageConfigurator } from "@/components/invite-page-configurator";
import { type EnabledFields } from "@/components/recipient-fields";
import { saveBook, type BookFormValues, type SaveBookState } from "./actions";

const initialState: SaveBookState = {};

const inputClasses =
  "h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-3 focus:ring-ring/25 ";

type BookFormProps = {
  urlPrefix: string;
  defaults: BookFormValues;
  currentSlug: string;
};

export function BookForm({ urlPrefix, defaults, currentSlug }: BookFormProps) {
  const [state, formAction, pending] = useActionState(saveBook, initialState);
  const [displayName, setDisplayName] = useState(defaults.display_name);
  const [slugValue, setSlugValue] = useState(defaults.slug);
  const [senderCountry, setSenderCountry] = useState(defaults.sender_country);
  const [enabledFields, setEnabledFields] = useState<EnabledFields>({
    partner_name: defaults.partner_name,
    kids_names: defaults.kids_names,
    birthday: defaults.birthday,
  });

  // Slug-change guard (client-side UX only — not a security control): a
  // changed slug breaks every already-shared link AND frees the old slug for
  // anyone else to claim, so editing it requires explicit acknowledgment.
  const [slugChangeAcked, setSlugChangeAcked] = useState(false);
  const slugChanged = slugValue !== currentSlug;

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-6">
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

      <section
        aria-labelledby="owner-details-heading"
        className="rounded-xl border border-border bg-secondary/50 p-5  "
      >
        <h2
          id="owner-details-heading"
          className="text-sm font-semibold text-foreground"
        >
          Your details
        </h2>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="display_name"
              className="text-sm font-medium text-foreground"
            >
              Your name
            </label>
            <input
              id="display_name"
              name="display_name"
              type="text"
              required
              maxLength={200}
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Sean"
              className={inputClasses}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="slug"
              className="text-sm font-medium text-foreground"
            >
              Link name
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="shrink-0 font-mono text-sm text-muted-foreground">
                {urlPrefix}
              </span>
              <input
                id="slug"
                name="slug"
                type="text"
                required
                pattern="[a-z0-9][a-z0-9\-]{2,62}"
                title="3-63 chars; lowercase letters, numbers, hyphens; must start alphanumeric"
                value={slugValue}
                onChange={(event) => {
                  setSlugValue(event.target.value);
                  setSlugChangeAcked(false);
                }}
                placeholder="my-address-book"
                className={`${inputClasses} w-full`}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex max-w-sm flex-col gap-1.5">
          <label htmlFor="sender_country" className="text-sm font-medium text-foreground">
            I mail from
          </label>
          <CountrySelect
            id="sender_country"
            name="sender_country"
            value={senderCountry}
            onChange={setSenderCountry}
            className={inputClasses}
            describedBy="sender_country-hint"
          />
          <p id="sender_country-hint" className="text-xs text-muted-foreground">
            Envelopes to this country leave the country line off.
          </p>
        </div>

        {slugChanged ? (
          <div
            role="alert"
            className="mt-4 flex flex-col gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            <p>
              Changing your link immediately breaks the old one — and frees it
              for anyone else to claim. Links you&apos;ve already shared will
              stop working.
            </p>
            <label className="flex items-center gap-2.5 font-medium">
              <input
                type="checkbox"
                checked={slugChangeAcked}
                onChange={(event) => setSlugChangeAcked(event.target.checked)}
                className="size-4 rounded border-amber-400 accent-amber-700 dark:border-amber-700 dark:accent-amber-400"
              />
              I understand
            </label>
          </div>
        ) : null}
      </section>

      <InvitePageConfigurator
        ownerName={displayName.trim()}
        publicUrl={`${urlPrefix}${slugValue}`}
        enabledFields={enabledFields}
        linkIsLive={!slugChanged}
        onFieldChange={(name, enabled) =>
          setEnabledFields((current) => ({ ...current, [name]: enabled }))
        }
        senderCountry={senderCountry}
      />

      <input
        type="hidden"
        name="partner_name"
        value={enabledFields.partner_name ? "on" : "off"}
      />
      <input
        type="hidden"
        name="kids_names"
        value={enabledFields.kids_names ? "on" : "off"}
      />
      <input
        type="hidden"
        name="birthday"
        value={enabledFields.birthday ? "on" : "off"}
      />

      <button
        type="submit"
        disabled={pending || (slugChanged && !slugChangeAcked)}
        className="h-10 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50  sm:self-end"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
