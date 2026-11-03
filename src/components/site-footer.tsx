import Link from "next/link";
import { SealedMark } from "@/components/sealed-mark";

export function SiteFooter({ lead = "Sent with Sealed" }: { lead?: string } = {}) {
  return (
    <footer className="flex items-center justify-center gap-2 px-4 pt-2 pb-6 text-[13px] text-muted-foreground">
      <SealedMark className="size-3.5" />
      <span>{lead} ·</span>
      <Link
        href="/about"
        className="text-foreground/80 underline underline-offset-4 hover:text-foreground"
      >
        What is this?
      </Link>
    </footer>
  );
}

export function RecipientFooter() {
  return (
    <footer className="flex items-center justify-center gap-1.5 px-4 pt-2 pb-6 text-[13px] text-muted-foreground">
      <SealedMark className="size-3.5" />
      <span>
        Sent with{" "}
        <Link
          href="/about"
          className="text-foreground/80 underline underline-offset-4 hover:text-foreground"
        >
          Sealed
        </Link>{" "}
        · A small project by Sean Oliver
      </span>
    </footer>
  );
}
