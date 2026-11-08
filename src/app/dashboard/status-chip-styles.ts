import type { StatusKey } from "@/lib/contacts-sheet";

export const chipBase =
  "inline-flex items-center rounded-full border px-2 py-px text-xs font-medium whitespace-nowrap";

export const chipStyles: Record<StatusKey, string> = {
  updated:
    "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200",
  confirmed:
    "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200",
  none: "border-border bg-secondary/50 text-muted-foreground",
  sent: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  delivered:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
  opened:
    "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  bounced:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  complained:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  failed:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  unconfirmed:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

export const chipLabels: Record<StatusKey, string> = {
  updated: "Updated",
  confirmed: "Confirmed",
  none: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  bounced: "Bounced",
  complained: "Complained",
  failed: "Not sent",
  unconfirmed: "Unconfirmed",
};
