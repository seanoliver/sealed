import Link from "next/link";
import { redirect } from "next/navigation";
import { SealedWordmark } from "@/components/sealed-mark";
import { requireUser } from "@/lib/auth";
import { getOwnBook } from "@/lib/queries/books";
import { countPendingSubmissions } from "@/lib/queries/submissions";
import { OWNER_NAV_LINKS } from "./nav-links";
import { CountPill, OwnerMenu } from "./owner-menu";

const navLinkClasses =
  "hidden items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium sm:inline-flex text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const claims = await requireUser();
  const book = await getOwnBook(claims);
  if (!book) redirect("/onboarding");
  const reviewCount = await countPendingSubmissions(claims, book.id);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="relative z-30 border-b border-border/80 bg-card/80 backdrop-blur">
        <nav className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center gap-1 px-4 py-2">
          <Link href="/dashboard" className="mr-4 flex items-center gap-2">
            <SealedWordmark />
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold uppercase leading-snug tracking-wide text-accent-foreground">
              Beta
            </span>
          </Link>
          {OWNER_NAV_LINKS.map(({ href, label }) => (
            <Link key={href} href={href} className={navLinkClasses}>
              {label}
              {href === "/dashboard/review" && reviewCount > 0 && <CountPill count={reviewCount} />}
            </Link>
          ))}
          <form action="/auth/signout" method="post" className="ml-auto hidden sm:block">
            <button type="submit" className="h-9 rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted">Sign out</button>
          </form>
          <OwnerMenu reviewCount={reviewCount} />
        </nav>
      </header>
      {children}
    </div>
  );
}
