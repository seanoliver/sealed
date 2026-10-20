import { Fragment } from "react";
import { nameSegments, type Readings } from "@/lib/readings";
import { cn } from "@/lib/utils";

/** Owner-only: never render on recipient pages, in emails, exports or print. */
export function NameWithReading({
  text,
  readings,
  show = true,
  className,
}: {
  text: string;
  readings: Readings;
  show?: boolean;
  className?: string;
}) {
  const segments = show ? nameSegments(text, readings) : [];
  if (!segments.some((segment) => segment.kind === "ruby")) {
    return className ? <span className={className}>{text}</span> : <>{text}</>;
  }
  return (
    <span className={cn("leading-[2.1]", className)}>
      {/* Ruby splits the accessible name per character; read the plain name instead. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {segments.map((segment, i) =>
          segment.kind === "text" ? (
            <Fragment key={i}>{segment.text}</Fragment>
          ) : (
            <ruby key={i} className="text-[1.12em] [ruby-align:center]">
              {segment.parts.map((part, j) => (
                <Fragment key={j}>
                  {part.base}
                  <rt className="px-[0.2em] font-sans text-[10px] font-normal tracking-normal text-muted-foreground normal-case">
                    {part.rt}
                  </rt>
                </Fragment>
              ))}
            </ruby>
          ),
        )}
      </span>
    </span>
  );
}
