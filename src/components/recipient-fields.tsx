import { HouseholdFields } from "@/components/household-fields";
import { inputClasses, labelClasses } from "@/components/recipient-field-styles";
import { type TokenUpdateValues } from "@/lib/validation/contact";
import {
  type HouseholdFieldErrors,
  type HouseholdValues,
} from "@/lib/validation/household";

export type EnabledFields = {
  partner_name: boolean;
  kids_names: boolean;
  birthday: boolean;
};

export const BLANK_RECIPIENT_VALUES: TokenUpdateValues = {
  full_name: "",
  partner_name: "",
  kids_names: "",
  email: "",
  birthday: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state_region: "",
  postal_code: "",
  country: "",
};

type RecipientFieldsProps = {
  defaults: TokenUpdateValues;
  enabled: EnabledFields;
  emailHint?: string;
  /** Renders the household builder in place of the legacy name fields. */
  household?: { defaults: HouseholdValues; errors?: HouseholdFieldErrors };
};

type FieldProps = {
  name: keyof TokenUpdateValues;
  label: string;
  value: string;
  type?: "text" | "email" | "date";
  maxLength?: number;
  hint?: string;
};

function Field({
  name,
  label,
  value,
  type = "text",
  maxLength,
  hint,
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
        className={inputClasses}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Legacy display-string name fields, still used by /u/[token]. */
function LegacyNameFields({
  defaults: v,
  enabled,
}: {
  defaults: TokenUpdateValues;
  enabled: EnabledFields;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="full_name" className={labelClasses}>
          Full name
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          required
          maxLength={200}
          defaultValue={v.full_name}
          className={inputClasses}
        />
      </div>

      {enabled.partner_name ? (
        <Field
          name="partner_name"
          label="Partner name"
          value={v.partner_name}
          maxLength={200}
        />
      ) : null}
      {enabled.kids_names ? (
        <Field
          name="kids_names"
          label="Kids' names"
          value={v.kids_names}
          maxLength={2000}
          hint="Comma separated."
        />
      ) : null}
    </>
  );
}

/** The shared field layout for live recipient forms and inert previews. */
export function RecipientFields({
  defaults: v,
  enabled,
  emailHint,
  household,
}: RecipientFieldsProps) {
  return (
    <>
      {household ? (
        <HouseholdFields
          defaults={household.defaults}
          enabled={enabled}
          errors={household.errors}
        />
      ) : (
        <LegacyNameFields defaults={v} enabled={enabled} />
      )}
      <Field
        name="email"
        label="Email"
        value={v.email}
        type="email"
        maxLength={320}
        hint={emailHint}
      />
      {enabled.birthday ? (
        <Field
          name="birthday"
          label="Birthday"
          value={v.birthday}
          type="date"
        />
      ) : null}
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
    </>
  );
}
