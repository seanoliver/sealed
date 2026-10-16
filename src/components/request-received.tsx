import type { ReactNode } from "react";

export function RequestReceived({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-serif text-3xl text-foreground">Your request is in</h2>
      <div
        role="status"
        className="rounded-xl border border-green-500/25 bg-green-500/10 p-4 leading-relaxed text-foreground"
      >
        {children}
      </div>
      {footer}
    </div>
  );
}
