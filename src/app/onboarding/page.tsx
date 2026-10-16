import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { googleDisplayName, suggestLinkName } from "@/lib/onboarding";
import { getOwnBook, getOwnProfile } from "@/lib/queries/books";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const claims = await requireUser();
  const [book, profile] = await Promise.all([
    getOwnBook(claims),
    getOwnProfile(claims),
  ]);
  if (book) redirect("/dashboard");

  const email = typeof claims.email === "string" ? claims.email : "";
  const displayName = profile?.displayName.trim() || (await googleDisplayName(await createClient()));

  return (
    <main className="flex flex-1">
      <OnboardingForm
        urlPrefix={`${process.env.APP_URL}/b/`}
        defaults={{
          display_name: displayName,
          slug: suggestLinkName(email),
          partner_name: false,
          kids_names: false,
          birthday: false,
        }}
      />
    </main>
  );
}
