import { type ReactNode } from "react";
import { type EnvelopeLine } from "@/lib/address";

type EnvelopeProps = {
  lines: readonly EnvelopeLine[];
  /** Mark the lines the format capitalized, so the writer sees what changed. */
  highlight?: boolean;
  caption?: ReactNode;
  className?: string;
};

/** An envelope's face: stamp corner, then the address lines as they will print. */
export function Envelope({ lines, highlight = false, caption, className = "" }: EnvelopeProps) {
  return (
    <div className={`rounded-md border border-border bg-background px-4 pt-4 pb-5 ${className}`}>
      <div
        aria-hidden="true"
        className="ml-auto h-11 w-9 rounded-sm border border-dashed border-border"
      />
      <address className="mt-3 pl-6 font-serif text-lg leading-relaxed not-italic text-foreground">
        {lines.map((line, i) => (
          <span
            key={`${i}-${line.text}`}
            data-uppercased={highlight && line.uppercased ? true : undefined}
            className={`block ${highlight && line.uppercased ? "-mx-1 bg-accent px-1" : ""}`}
          >
            {line.text}
          </span>
        ))}
      </address>
      {caption ? <p className="mt-3 pl-6 text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}
