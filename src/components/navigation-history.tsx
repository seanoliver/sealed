"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

let navigatedInApp = false;
let previousPath: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function cameFromSealed(): boolean {
  if (navigatedInApp) return true;
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Client-side navigations leave document.referrer unchanged, so they are counted here. */
export function NavigationTracker() {
  const pathname = usePathname();
  const first = useRef(true);
  const last = useRef(pathname);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    navigatedInApp = true;
    previousPath = last.current;
    last.current = pathname;
    listeners.forEach((listener) => listener());
  }, [pathname]);
  return null;
}

/** True when the page before this one was `path`, so going back returns there. Call it from an event handler. */
export function cameFromPath(path: string): boolean {
  if (previousPath !== null) return previousPath === path;
  try {
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin && referrer.pathname === path;
  } catch {
    return false;
  }
}

export function useCameFromSealed(): boolean {
  return useSyncExternalStore(subscribe, cameFromSealed, () => false);
}
