import Link from "next/link";
import { redirect } from "next/navigation";
import { SealedWordmark } from "@/components/sealed-mark";
import { requireUser } from "@/lib/auth";
import { getOwnBook } from "@/lib/queries/books";

const navLinkClasses =
  "rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const claims = await requireUser();
  if (!(await getOwnBook(claims))) redirect("/onboarding");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="border-b border-border/80 bg-card/80 backdrop-blur">
        <nav className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center gap-1 px-4 py-2">
          <Link href="/dashboard" className="mr-4 flex items-center gap-2">
            <SealedWordmark />
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold uppercase leading-snug tracking-wide text-accent-foreground">
              Beta
            </span>
          </Link>
          <Link href="/dashboard" className={navLinkClasses}>Contacts</Link>
          <Link href="/dashboard/review" className={navLinkClasses}>Review</Link>
          <Link href="/dashboard/settings" className={navLinkClasses}>Settings</Link>
          <form action="/auth/signout" method="post" className="ml-auto">
            <button type="submit" className="h-9 rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted">Sign out</button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}
