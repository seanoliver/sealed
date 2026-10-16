"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

/**
 * Cloudflare Turnstile widget, explicit-rendering mode.
 *
 * This is the ONE sanctioned external script in the app. CSP note for
 * Task 18: `script-src` must allow https://challenges.cloudflare.com and
 * `frame-src` must allow it too (the widget renders its challenge in an
 * iframe from that origin). Nothing else external is permitted.
 *
 * Render this component inside the form it protects: the widget adds a hidden
 * `cf-turnstile-response` input to the enclosing <form>.
 */

type TurnstileGlobal = {
  render: (container: HTMLElement, options: { sitekey: string }) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

function turnstileGlobal(): TurnstileGlobal | undefined {
  return (window as { turnstile?: TurnstileGlobal }).turnstile;
}

/**
 * Explicit rendering, because implicit mode only scans the page once: a
 * remounted form would get no widget and fail verification on every submit.
 *
 * Responses are single-use at siteverify, so pass the form's action state as
 * `resetOn`: each new state after a submit gets a fresh response.
 */
export function TurnstileWidget({ resetOn }: { resetOn?: unknown } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [widgetId, setWidgetId] = useState<string>();
  const initialResetOn = useRef(resetOn);

  function renderWidget() {
    const turnstile = turnstileGlobal();
    const container = containerRef.current;
    if (!turnstile || !container || container.childElementCount > 0) return;
    setWidgetId(
      turnstile.render(container, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
      }),
    );
  }

  useEffect(() => {
    if (!widgetId) return;
    return () => turnstileGlobal()?.remove(widgetId);
  }, [widgetId]);

  useEffect(() => {
    if (!widgetId || resetOn === initialResetOn.current) return;
    turnstileGlobal()?.reset(widgetId);
  }, [resetOn, widgetId]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={renderWidget}
      />
      <div ref={containerRef} />
    </>
  );
}
