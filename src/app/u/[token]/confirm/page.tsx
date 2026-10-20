import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { formatEnvelope } from "@/lib/address";
import { envelopeLine } from "@/lib/names";
import { TOKEN_SHAPE } from "@/lib/tokens";
import { Notice } from "../../notice";
import { loadTokenPage } from "../load";
import { isSpentToken } from "../owner";
import { storedNames, tokenAddress } from "../token-data";
import { confirmTokenAddress } from "./actions";
import { ConfirmEnvelope } from "./confirm-envelope";
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

  const household = envelopeLine(storedNames(contact), {
    partner: enabled_fields.partner_name,
  });
  const envelope = formatEnvelope(tokenAddress(contact), {
    name: household,
    senderCountry: loaded.data.sender_country,
  });
  if (envelope === null) redirect(`/u/${token}`);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <ConfirmEnvelope
        action={confirmTokenAddress.bind(null, token)}
        ownerName={ownerName}
        lines={envelope.lines}
        name={household}
        street={contact.address_line1 ?? ""}
        updateHref={`/u/${token}`}
        seenAt={loaded.data.updated_at}
      />
      <div className="mt-4">
        <WhyExplainer ownerName={ownerName} />
      </div>
    </main>
  );
}
