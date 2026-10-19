"use client";

import { useCameFromSealed } from "@/components/navigation-history";

export function BackLink() {
  if (!useCameFromSealed()) return null;
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
