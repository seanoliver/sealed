import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { InvitePageIntroduction } from "@/components/invite-page-introduction";
import { BLANK_RECIPIENT_VALUES } from "@/components/recipient-fields";
import { RecipientForm } from "@/components/recipient-form";
import { checkRateLimit } from "@/lib/db/rate-limit";
import { logDbError } from "@/lib/log";
import {
  getPublicBook,
  SLUG_SHAPE,
  type PublicBook,
} from "@/lib/queries/public-book";
import { hashedIpKey, requestIp } from "@/lib/request-ip";
import { BLANK_HOUSEHOLD_VALUES } from "@/lib/validation/household";
import { Notice } from "../../u/notice";
import { submitToBook } from "./actions";

/**
 * Deliberately NO robots noindex here: unlike /u/[token], the permalink is
 * meant to be shared publicly. What keeps it safe is that the page is
 * write-only — the DOM carries nothing beyond the owner display name and
 * which optional fields are enabled.
 */
export const metadata: Metadata = {
  title: "Add your address",
};

/**
 * Fully public, unauthenticated, WRITE-ONLY page. Every input is hostile and
 * the response must leak NOTHING about the book's contents: no ids, no
 * counts, no contact data — only {owner name, enabled-field flags}, all of
 * which the owner chose to publish by sharing the link. No cookies,
 * no auth (excluded from the proxy matcher).
 */
export default async function PublicBookPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // 1. Shape gate FIRST: a malformed slug can never exist (DB CHECK), so it
  //    404s with ZERO DB work — no rate-limit row, no lookup.
  if (!SLUG_SHAPE.test(slug)) notFound();

  // 2. View rate limit: 60/hour per hashed IP. Fail CLOSED on limiter
  //    outage — refuse rather than serve unmetered.
  const ip = await requestIp();
  let allowed = false;
  try {
    allowed = await checkRateLimit(hashedIpKey("permalink-view", ip), 60, 3600);
  } catch (err) {
    logDbError("[pb] [PublicBookPage] rate-limit check failed", err);
  }
  if (!allowed) {
    return (
      <Notice title="Too many requests">
        Too many requests — please try again later.
      </Notice>
    );
  }

  // 3. Book lookup: {owner name, enabled flags} ONLY. Unknown slug →
  //    the standard 404 (nothing to enumerate: slugs are public by design,
  //    and a 404 confirms only non-existence).
  let book: PublicBook | null = null;
  try {
    book = await getPublicBook(slug);
  } catch (err) {
    logDbError("[pb] [PublicBookPage] getPublicBook failed", err);
    return (
      <Notice title="Something went wrong">
        Something went wrong. Please try again later.
      </Notice>
    );
  }
  if (!book) notFound();

  const ownerLabel = book.ownerName;

  // Bind the slug server-side — it is public (it's in the URL), so the
  // bound-arg round trip through the client is harmless here.
  const action = submitToBook.bind(null, slug);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm ">
        <InvitePageIntroduction ownerName={ownerLabel} />

        <RecipientForm
          action={action}
          defaults={BLANK_RECIPIENT_VALUES}
          enabled={book.enabledFields}
          submitLabel="Add my details"
          pendingLabel="Submitting…"
          emailHint={`Optional — but include it so ${ownerLabel} can reach you.`}
          household={BLANK_HOUSEHOLD_VALUES}
        />
      </div>
    </main>
  );
}
