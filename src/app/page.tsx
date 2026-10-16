import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { RequestAccess, type SignInError } from "@/components/request-access-form";
import { RequestReceived } from "@/components/request-received";
import { SealedWordmark } from "@/components/sealed-mark";
import { currentUser } from "@/lib/auth";
import { SITE_DESCRIPTION } from "@/lib/branding";
import { WAITLIST_REJECTION } from "@/lib/waitlist";

export const metadata: Metadata = {
  title: { absolute: "Sealed" },
  alternates: { canonical: "/" },
  openGraph: {
    title: "Sealed",
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: "Sealed",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/social-card",
        width: 1200,
        height: 630,
        alt: "Sealed — a private address book",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sealed",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/social-card",
        alt: "Sealed — a private address book",
      },
    ],
  },
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    requested?: string;
    error?: string;
    error_description?: string;
  }>;
}) {
  if (await currentUser()) redirect("/dashboard");
  const params = await searchParams;
  // Supabase falls back to the Site URL when it cannot use redirect_to, so a
  // waitlisted Google sign-up can arrive here instead of via /auth/confirm.
  const googleRequested =
    params.requested === "google" ||
    params.error_description === WAITLIST_REJECTION;
  // Not `=== "oauth"`: a Google error that fell back to the Site URL arrives as error=access_denied.
  const signInError: SignInError | undefined =
    params.error === "1" ? "link" : params.error ? "oauth" : undefined;

  return (
    <main className="flex flex-1 items-center px-5 py-12 sm:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <SealedWordmark />
        <div className="overflow-hidden rounded-3xl border bg-card shadow-xl shadow-foreground/5 md:grid md:grid-cols-2">
          <section className="flex flex-col justify-between gap-10 bg-primary p-6 text-primary-foreground sm:p-11">
            <p className="flex w-fit items-center gap-2 rounded-full border border-primary-foreground/35 px-3.5 py-1.5 text-sm font-medium">
              <span className="size-2 rounded-full bg-primary-foreground" aria-hidden="true" />
              Private beta · by invitation
            </p>
            <div className="flex flex-col gap-4">
              <h1 className="font-serif text-4xl leading-[1.06] text-balance sm:text-5xl">
                Holiday cards without <em>chasing addresses.</em>
              </h1>
              <p className="leading-relaxed text-pretty text-primary-foreground/85">
                Send one link to everyone on your list. They fill in their own
                details, and you get an address book that’s ready to print.
              </p>
            </div>
            <p className="text-sm text-primary-foreground/75">
              We’re sending invitations in small batches so every book gets attention.
            </p>
          </section>
          <section aria-label="Request an invitation" className="p-6 sm:p-11">
            {googleRequested ? (
              <RequestReceived
                footer={
                  <Link
                    href="/"
                    className="w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Back to sign in
                  </Link>
                }
              >
                You’re on the list, and your invitation will arrive at the
                email on your Google account.
              </RequestReceived>
            ) : (
              <RequestAccess error={signInError} />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
