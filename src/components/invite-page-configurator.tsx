"use client";

import { Cake, Eye, Heart, Link2, Lock, Users } from "lucide-react";
import { InvitePageIntroduction } from "@/components/invite-page-introduction";
import {
  BLANK_RECIPIENT_VALUES,
  RecipientFields,
  type EnabledFields,
} from "@/components/recipient-fields";
import { BLANK_HOUSEHOLD_VALUES } from "@/lib/validation/household";
import { Switch } from "@/components/ui/switch";

const OPTIONAL_FIELDS = [
  [
    "partner_name",
    "Partner name",
    "Ask for a spouse or partner’s name.",
    Heart,
  ],
  ["kids_names", "Kids' names", "Collect the names of any children.", Users],
  ["birthday", "Birthday", "A date to remember for cards.", Cake],
] as const;

type InvitePageConfiguratorProps = {
  ownerName: string;
  publicUrl: string;
  enabledFields: EnabledFields;
  linkIsLive?: boolean;
  onFieldChange: (name: keyof EnabledFields, enabled: boolean) => void;
  senderCountry: string;
};

/** Optional-field controls paired with a deliberately inert invite preview. */
export function InvitePageConfigurator({
  ownerName,
  publicUrl,
  enabledFields,
  linkIsLive = false,
  onFieldChange,
  senderCountry,
}: InvitePageConfiguratorProps) {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-10">
      <aside className="flex flex-col gap-6">
        <div>
          <h2 className="font-serif text-lg text-foreground">
            Optional fields
          </h2>
          <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
            All optional fields start off. Add only what you want to ask for.
          </p>
        </div>

        <fieldset>
          <legend className="sr-only">Optional fields to request</legend>
          <ul className="flex flex-col divide-y divide-border/70" role="list">
            {OPTIONAL_FIELDS.map(([name, label, description, Icon]) => {
              const labelId = `optional-${name}`;
              const descriptionId = `${labelId}-description`;
              return (
                <li
                  key={name}
                  className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="flex flex-col">
                      <span
                        id={labelId}
                        className="text-sm font-medium text-foreground"
                      >
                        {label}
                      </span>
                      <span
                        id={descriptionId}
                        className="text-sm text-muted-foreground"
                      >
                        {description}
                      </span>
                    </div>
                  </div>
                  <Switch
                    checked={enabledFields[name]}
                    onCheckedChange={(checked) => onFieldChange(name, checked)}
                    aria-labelledby={labelId}
                    aria-describedby={descriptionId}
                  />
                </li>
              );
            })}
          </ul>
        </fieldset>

        <div className="flex flex-col gap-1.5 rounded-lg border bg-secondary/40 p-3.5">
          <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Link2 className="size-3.5" aria-hidden="true" />
            {linkIsLive ? "Your public link" : "Your future public link"}
          </span>
          {linkIsLive ? (
            <a
              href={publicUrl}
              className="break-all text-sm text-foreground underline-offset-2 hover:underline"
            >
              {publicUrl}
            </a>
          ) : (
            <span className="break-all text-sm text-foreground">
              {publicUrl}
            </span>
          )}
        </div>
      </aside>

      <section
        aria-label="Invite page preview"
        className="flex min-w-0 flex-col gap-3"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Eye className="size-4" aria-hidden="true" />
          Preview <span aria-hidden="true">—</span>
          <span className="font-normal">what friends will see</span>
        </div>
        <div className="overflow-hidden rounded-2xl border bg-muted/40 shadow-sm">
          <div className="flex items-center gap-3 border-b border-border/70 bg-secondary/50 px-4 py-2.5">
            <div className="flex gap-1.5" aria-hidden="true">
              <span className="size-2.5 rounded-full bg-border" />
              <span className="size-2.5 rounded-full bg-border" />
              <span className="size-2.5 rounded-full bg-border" />
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
              <Lock className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{publicUrl}</span>
            </div>
          </div>
          <div className="bg-card p-6 sm:p-8">
            <div className="mx-auto max-w-md">
              <InvitePageIntroduction
                ownerName={ownerName || "Your friend"}
                headingLevel="h3"
              />
              <fieldset disabled className="mt-6 flex flex-col gap-4">
                <RecipientFields
                  defaults={BLANK_RECIPIENT_VALUES}
                  enabled={enabledFields}
                  household={{ defaults: BLANK_HOUSEHOLD_VALUES }}
                  ownerName={ownerName || "Your friend"}
                  senderCountry={senderCountry}
                />
                <button
                  type="button"
                  disabled
                  className="mt-2 h-11 rounded-lg bg-primary/90 text-sm font-medium text-primary-foreground opacity-90"
                >
                  Add my details
                </button>
                <p className="text-center text-xs text-muted-foreground">
                  Protected from spam. No account needed.
                </p>
              </fieldset>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
