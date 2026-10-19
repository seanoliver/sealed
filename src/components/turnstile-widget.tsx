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
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: "always" | "execute" | "interaction-only";
      callback: () => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      "before-interactive-callback": () => void;
      "after-interactive-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

function turnstileGlobal(): TurnstileGlobal | undefined {
  return (window as { turnstile?: TurnstileGlobal }).turnstile;
}

export type TurnstileStatus = "checking" | "ready" | "failed";

/**
 * Keep explicit rendering: implicit mode scans the page once, so a remounted form gets no widget.
 * Pass the action state as `resetOn`; siteverify consumes each response.
 */
export function TurnstileWidget({
  resetOn,
  onStatusChange,
}: {
  resetOn?: unknown;
  onStatusChange?: (status: TurnstileStatus) => void;
} = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [widgetId, setWidgetId] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const initialResetOn = useRef(resetOn);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  });
  const fail = () => {
    setFailed(true);
    onStatusChangeRef.current?.("failed");
  };

  function renderWidget() {
    const turnstile = turnstileGlobal();
    const container = containerRef.current;
    if (!turnstile || !container || container.childElementCount > 0) return;
    setWidgetId(
      turnstile.render(container, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
        appearance: "interaction-only",
        callback: () => {
          setFailed(false);
          onStatusChangeRef.current?.("ready");
        },
        "expired-callback": () => onStatusChangeRef.current?.("checking"),
        "error-callback": fail,
        "before-interactive-callback": () => setInteractive(true),
        "after-interactive-callback": () => setInteractive(false),
      }),
    );
  }

  useEffect(() => {
    if (!widgetId) return;
    return () => turnstileGlobal()?.remove(widgetId);
  }, [widgetId]);

  useEffect(() => {
    if (!widgetId || resetOn === initialResetOn.current) return;
    onStatusChangeRef.current?.("checking");
    turnstileGlobal()?.reset(widgetId);
  }, [resetOn, widgetId]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={renderWidget}
        onError={fail}
      />
      <div ref={containerRef} className={interactive ? undefined : "hidden"} />
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          The verification check didn’t load. Allow challenges.cloudflare.com in
          any content blocker, then reload the page.
        </p>
      ) : null}
    </>
  );
}
