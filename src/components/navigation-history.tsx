"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

let navigatedInApp = false;
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
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    navigatedInApp = true;
    listeners.forEach((listener) => listener());
  }, [pathname]);
  return null;
}

export function useCameFromSealed(): boolean {
  return useSyncExternalStore(subscribe, cameFromSealed, () => false);
}
