export {
  COUNTRY_OPTIONS,
  countryCodeFor,
  countryName,
  getCountry,
  isCountryCode,
  type Country,
} from "./countries";
export {
  addressSummary,
  envelopeLines,
  formatEnvelope,
  isLocalScript,
  rowAddress,
  type Envelope,
  type EnvelopeLine,
  type PostalAddress,
} from "./format";

export const DEFAULT_SENDER_COUNTRY = "US";
