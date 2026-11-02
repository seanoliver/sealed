import { type Metadata } from "next";
import { TOKEN_SHAPE } from "@/lib/tokens";
import { Notice } from "../../notice";
import { saveTokenUpdate } from "../actions";
import { loadTokenPage } from "../load";
import { isSpentToken } from "../owner";
import { recipientPrefill } from "../token-data";
import { confirmTokenAddress } from "./actions";
import { EnvelopeEditor } from "./envelope-editor";
import { WhyExplainer } from "@/components/why-explainer";

export const metadata: Metadata = {
  title: "Confirm your address",
  robots: { index: false, follow: false },
};

export default async function ConfirmAddressPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const loaded = await loadTokenPage(token);
  if ("notice" in loaded) {
    if (
      loaded.invalid &&
      TOKEN_SHAPE.test(token) &&
      (await isSpentToken(token))
    ) {
      return (
        <Notice title="You're already on the list">
          Thanks, your reply is saved. You can close this page.
        </Notice>
      );
    }
    return loaded.notice;
  }
  const { contact, enabled_fields, owner_name: ownerName } = loaded.data;
  const { household, defaults } = recipientPrefill(loaded.data);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <EnvelopeEditor
        confirm={confirmTokenAddress.bind(null, token)}
        save={saveTokenUpdate.bind(null, token)}
        ownerName={ownerName}
        defaults={defaults}
        household={household}
        enabled={enabled_fields}
        senderCountry={loaded.data.sender_country}
        legacyCountry={contact.country_code ? null : contact.country}
        seenAt={loaded.data.updated_at}
        fullFormHref={`/u/${token}`}
      />
      <div className="mt-4">
        <WhyExplainer ownerName={ownerName} />
      </div>
    </main>
  );
}
