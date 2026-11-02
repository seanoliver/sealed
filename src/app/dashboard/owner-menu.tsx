"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { currentNavHref, OWNER_NAV_LINKS } from "./nav-links";

const rowClasses =
  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[15px] text-foreground transition-colors hover:bg-muted";

export function OwnerMenu({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [shownPath, setShownPath] = useState(pathname);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetId = useId();
  const current = currentNavHref(pathname);

  // Close on route change (back/forward, or a link elsewhere on the page).
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(false);
  }

  function close({ restoreFocus }: { restoreFocus: boolean }) {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      // Keep Tab inside the button and the sheet while the scrim is up.
      const items = [
        buttonRef.current,
        ...(sheetRef.current?.querySelectorAll<HTMLElement>("a, button") ?? []),
      ].filter((item): item is HTMLElement => item !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    // The sheet is phone-only; widening the window past `sm` closes it.
    const wide = window.matchMedia("(min-width: 40rem)");
    function onWide(event: MediaQueryListEvent) {
      if (event.matches) setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    wide.addEventListener("change", onWide);
    return () => {
      root.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  return (
    <div className="ml-auto sm:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={sheetId}
        onClick={() => (open ? close({ restoreFocus: false }) : setOpen(true))}
        className="relative grid size-9 place-items-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-muted"
      >
        {open ? <X className="size-[18px]" aria-hidden="true" /> : <Menu className="size-[18px]" aria-hidden="true" />}
        {!open && reviewCount > 0 && (
          <span aria-hidden="true" data-testid="review-dot" className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" />
        )}
      </button>

      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => close({ restoreFocus: true })}
            className="absolute inset-x-0 top-full h-dvh bg-black/40 animate-in fade-in-0 duration-200"
          />
          <div
            ref={sheetRef}
            id={sheetId}
            className="absolute inset-x-0 top-full flex flex-col border-b border-border bg-card p-2 shadow-[0_14px_30px_-16px_rgb(0_0_0/0.35)] animate-in fade-in-0 slide-in-from-top-2 duration-200"
          >
            {OWNER_NAV_LINKS.map(({ href, label }) => {
              const isCurrent = href === current;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={isCurrent ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(rowClasses, isCurrent && "bg-muted font-medium")}
                >
                  {label}
                  {href === "/dashboard/review" && reviewCount > 0 && <CountPill count={reviewCount} />}
                </Link>
              );
            })}
            <hr className="my-1.5 border-border" />
            <form action="/auth/signout" method="post">
              <button type="submit" className={rowClasses}>Sign out</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

export function CountPill({ count }: { count: number }) {
  return (
    <span className="inline-grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
      {count}
      <span className="sr-only"> waiting</span>
    </span>
  );
}
