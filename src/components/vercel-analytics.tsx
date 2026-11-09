"use client";

import { Analytics } from "@vercel/analytics/next";
import { redactAnalyticsUrl } from "@/lib/analytics-url";

export function VercelAnalytics() {
  return <Analytics beforeSend={(event) => ({ ...event, url: redactAnalyticsUrl(event.url) })} />;
}
