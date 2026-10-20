"use client";

import { DEFAULT_SENDER_COUNTRY } from "@/lib/address";
import { useActionState, useState } from "react";
import { AlertCircle } from "lucide-react";
import { InvitePageConfigurator } from "@/components/invite-page-configurator";
import { SealedWordmark } from "@/components/sealed-mark";
import { type EnabledFields } from "@/components/recipient-fields";
import { StepProgress } from "@/components/step-progress";
import { Button } from "@/components/ui/button";
import {
  advanceOnboarding,
  type OnboardingState,
  type OnboardingValues,
} from "./actions";

const inputClasses =
  "h-12 w-full rounded-lg border border-input bg-card px-3.5 text-base text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25";

type OnboardingFormProps = { defaults: OnboardingValues; urlPrefix: string };

export function OnboardingForm({ defaults, urlPrefix }: OnboardingFormProps) {
  const initialState: OnboardingState = { step: "details", values: defaults };
  const [state, formAction, pending] = useActionState(
    advanceOnboarding,
    initialState,
  );
  const [enabledFields, setEnabledFields] = useState<EnabledFields>({
    partner_name: defaults.partner_name,
    kids_names: defaults.kids_names,
    birthday: defaults.birthday,
  });
  const values = state.values;
  const currentStep = state.step === "confirm" ? 2 : 1;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-16">
      <header className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <SealedWordmark />
          <StepProgress current={currentStep} />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-3xl leading-tight text-balance text-foreground sm:text-4xl">
            {currentStep === 1
              ? "Create your address book"
              : "Preview your invite page"}
          </h1>
          <p className="max-w-xl text-pretty text-muted-foreground">
            {currentStep === 1
              ? "Start with your name and the link you’ll share with friends."
              : "Choose the optional details you’d like friends to add. The preview updates as you make changes."}
          </p>
        </div>
      </header>

      {state.step === "confirm" ? (
        <form action={formAction} className="flex flex-col gap-8">
          {state.error ? <ErrorMessage>{state.error}</ErrorMessage> : null}
          <InvitePageConfigurator
            ownerName={values.display_name}
            publicUrl={`${urlPrefix}${values.slug}`}
            enabledFields={enabledFields}
            onFieldChange={(name, enabled) =>
              setEnabledFields((current) => ({ ...current, [name]: enabled }))
            }
            senderCountry={DEFAULT_SENDER_COUNTRY}
          />
          <input
            type="hidden"
            name="display_name"
            value={values.display_name}
          />
          <input type="hidden" name="slug" value={values.slug} />
          <OptionalFieldInputs enabledFields={enabledFields} />
          <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="submit"
              name="intent"
              value="back"
              variant="ghost"
              size="lg"
              formNoValidate
              disabled={pending}
              className="h-11 sm:px-5"
            >
              Back
            </Button>
            <Button
              type="submit"
              name="intent"
              value="create"
              size="lg"
              disabled={pending}
              className="h-11 w-full text-base sm:w-auto sm:px-6"
            >
              {pending ? "Creating…" : "Create my address book"}
            </Button>
          </div>
        </form>
      ) : (
        <form action={formAction} className="flex max-w-lg flex-col gap-7">
          {state.error ? <ErrorMessage>{state.error}</ErrorMessage> : null}
          <div className="flex flex-col gap-2">
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
              defaultValue={values.display_name}
              placeholder="Sean"
              className={inputClasses}
            />
            <p className="text-sm text-muted-foreground">
              A first name is fine. This will be visible to friends.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="slug"
              className="text-sm font-medium text-foreground"
            >
              Link name
            </label>
            <div className="flex h-12 w-full items-center overflow-hidden rounded-lg border border-input bg-card shadow-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
              <span className="flex h-full max-w-[55%] items-center truncate border-r border-border/70 bg-secondary/60 px-3.5 text-sm text-muted-foreground select-none">
                {urlPrefix}
              </span>
              <input
                id="slug"
                name="slug"
                type="text"
                required
                pattern="[a-z0-9][a-z0-9\-]{2,62}"
                title="3-63 chars; lowercase letters, numbers, hyphens; must start alphanumeric"
                defaultValue={values.slug}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent px-3 text-base text-foreground outline-none"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Lowercase letters, numbers, and hyphens. You can edit the
              suggestion.
            </p>
          </div>
          <OptionalFieldInputs enabledFields={enabledFields} />
          <Button
            type="submit"
            name="intent"
            value="continue"
            size="lg"
            disabled={pending}
            className="h-12 w-full text-base sm:w-auto sm:self-start sm:px-6"
          >
            {pending ? "Checking…" : "Continue to preview"}
          </Button>
        </form>
      )}

      <footer className="text-sm text-muted-foreground">
        Private by design. Friends can only add their own details — they never
        see anyone else’s.
      </footer>
    </div>
  );
}

function OptionalFieldInputs({
  enabledFields,
}: {
  enabledFields: EnabledFields;
}) {
  return (
    <>
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
    </>
  );
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {children}
    </div>
  );
}
