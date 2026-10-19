"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

function cameFromSealed(): boolean {
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function BackLink() {
  const canGoBack = useSyncExternalStore(subscribe, cameFromSealed, () => false);
  if (!canGoBack) return null;
  return (
    <button
      type="button"
      onClick={() => window.history.back()}
      className="text-sm font-semibold text-primary hover:underline"
    >
      ← Back
    </button>
  );
}
