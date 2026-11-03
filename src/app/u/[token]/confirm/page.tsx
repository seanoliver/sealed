import { type Metadata } from "next";
import { TOKEN_SHAPE } from "@/lib/tokens";
import { Notice } from "../../notice";
import { saveTokenUpdate } from "../actions";
import { loadTokenPage } from "../load";
import { isSpentToken } from "../owner";
import { recipientPrefill } from "../token-data";
import { confirmTokenAddress } from "./actions";
import { EnvelopeEditor } from "./envelope-editor";

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
      // Links stay open until they expire, so a used one landing here has expired.
      return (
        <Notice title="This link has expired">
          Your reply is saved. To change it, ask the person who sent this for a new link.
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
        senderNames={loaded.data.sender_full_names ?? ownerName}
        defaults={defaults}
        household={household}
        enabled={enabled_fields}
        senderCountry={loaded.data.sender_country}
        legacyCountry={contact.country_code ? null : contact.country}
        seenAt={loaded.data.updated_at}
        expiresAt={loaded.data.expires_at}
      />
    </main>
  );
}
