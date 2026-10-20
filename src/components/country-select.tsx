import { COUNTRY_OPTIONS } from "@/lib/address/countries";

export const SELECT_CHEVRON_CLASSES =
  "appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9";

export const SELECT_CHEVRON_STYLE = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23857a6e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
};

type CountrySelectProps = {
  id: string;
  name: string;
  value: string;
  onChange: (code: string) => void;
  className: string;
  /** Offer "Choose a country" for a contact that may stay without one. */
  allowBlank?: boolean;
  invalid?: boolean;
  describedBy?: string;
};

export function CountrySelect({
  id,
  name,
  value,
  onChange,
  className,
  allowBlank = false,
  invalid,
  describedBy,
}: CountrySelectProps) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      autoComplete="country"
      className={`${className} w-full min-w-0 ${SELECT_CHEVRON_CLASSES}`}
      style={SELECT_CHEVRON_STYLE}
    >
      {allowBlank || value === "" ? <option value="">Choose a country</option> : null}
      {COUNTRY_OPTIONS.map(([code, countryName]) => (
        <option key={code} value={code}>
          {countryName}
        </option>
      ))}
    </select>
  );
}
