import { type Metadata } from "next";
import { loadTokenPage } from "./load";
import { recipientPrefill } from "./token-data";
import { RecipientForm } from "@/components/recipient-form";
import { submitTokenUpdate } from "./actions";
import { WhyExplainer } from "@/components/why-explainer";

/**
 * Tokens are secrets carried in the URL — this route must NEVER be crawled,
 * indexed, or followed. (Task 18 additionally sends X-Robots-Tag here.)
 */
export const metadata: Metadata = {
  title: "Update your address",
  robots: { index: false, follow: false },
};

/**
 * Recipient update page. Unauthenticated and token-gated: no session, no
 * cookies (excluded from the proxy matcher), no auth calls. The DOM contains
 * ONLY display values — never owner/book/contact ids.
 */
export default async function TokenUpdatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const loaded = await loadTokenPage(token);
  if ("notice" in loaded) return loaded.notice;
  const { contact, enabled_fields, owner_name: ownerLabel } = loaded.data;

  const { household, defaults } = recipientPrefill(loaded.data);

  // Bind the token server-side. Note: bound args may round-trip through the
  // client in cleartext (observed in dev) — acceptable here only because the
  // recipient's browser already holds the token in the URL. Never bind
  // secrets the client shouldn't see.
  const action = submitTokenUpdate.bind(null, token);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm ">
        <h1 className="font-serif text-2xl leading-tight text-foreground">
          Update your address for {ownerLabel}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Check your details below, fix anything that&apos;s out of date, and
          hit update. Only {ownerLabel} can see what you enter.
        </p>

        <RecipientForm
          action={action}
          defaults={defaults}
          enabled={enabled_fields}
          submitLabel="Update my details"
          requireStreet
          pendingLabel="Saving…"
          household={household}
          seenAt={loaded.data.updated_at}
          ownerName={ownerLabel}
          senderCountry={loaded.data.sender_country}
          legacyCountry={contact.country_code ? null : contact.country}
        />
      </div>
      <div className="mt-4">
        <WhyExplainer ownerName={ownerLabel} />
      </div>
    </main>
  );
}
