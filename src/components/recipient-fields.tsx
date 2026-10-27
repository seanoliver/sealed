import { type Ref } from "react";
import {
  AddressFields,
  type AddressFieldsHandle,
} from "@/components/address-fields";
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
  district: "",
  city: "",
  state_region: "",
  postal_code: "",
  country_code: "",
};

type RecipientFieldsProps = {
  defaults: TokenUpdateValues;
  enabled: EnabledFields;
  emailHint?: string;
  household: { defaults: HouseholdValues; errors?: HouseholdFieldErrors };
  ownerName: string;
  senderCountry: string;
  legacyCountry?: string | null;
  addressRef?: Ref<AddressFieldsHandle>;
  errorsKey?: unknown;
  requireStreet?: boolean;
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

/** The shared field layout for live recipient forms and inert previews. */
export function RecipientFields({
  defaults: v,
  enabled,
  emailHint,
  household,
  ownerName,
  senderCountry,
  legacyCountry,
  addressRef,
  errorsKey,
  requireStreet,
}: RecipientFieldsProps) {
  return (
    <>
      <HouseholdFields
        defaults={household.defaults}
        enabled={enabled}
        errors={household.errors}
      />
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
      <AddressFields
        // A new sender country (the settings preview) starts the address over.
        key={senderCountry}
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
        audience={{ kind: "recipient", ownerName }}
        styles={{ input: inputClasses, label: labelClasses }}
        errors={{ postal_code: household.errors?.postal_code }}
        errorsKey={errorsKey}
        preview="below"
        handleRef={addressRef}
        requireStreet={requireStreet}
      />
    </>
  );
}
