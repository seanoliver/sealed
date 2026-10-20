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
  type Envelope,
  type EnvelopeLine,
  type PostalAddress,
} from "./format";

/** books.sender_country's default: a book mails from the US until its owner says otherwise. */
export const DEFAULT_SENDER_COUNTRY = "US";
