import Link from "next/link";
import { SealedMark } from "@/components/sealed-mark";

const MAKER_URL = "https://seanoliver.dev/";

const linkClasses = "text-foreground/80 underline underline-offset-4 hover:text-foreground";

function MakerLink() {
  return (
    <a href={MAKER_URL} target="_blank" rel="noopener" className={linkClasses}>
      Sean Oliver
    </a>
  );
}

export function SiteFooter({ showAbout = true }: { showAbout?: boolean } = {}) {
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 pt-2 pb-6 text-[13px] text-muted-foreground">
      <SealedMark className="size-3.5" />
      <span>
        Made by <MakerLink />
      </span>
      {showAbout && (
        <>
          <span aria-hidden="true">·</span>
          <Link href="/about" className={linkClasses}>
            What is this?
          </Link>
        </>
      )}
    </footer>
  );
}

export function RecipientFooter() {
  return (
    <footer className="flex items-center justify-center gap-1.5 px-4 pt-2 pb-6 text-[13px] text-muted-foreground">
      <SealedMark className="size-3.5" />
      <span>
        Sent with{" "}
        <Link href="/about" className={linkClasses}>
          Sealed
        </Link>{" "}
        · made by <MakerLink />
      </span>
    </footer>
  );
}
