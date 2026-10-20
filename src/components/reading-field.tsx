"use client";

import { useState } from "react";
import { NameWithReading } from "@/components/name-with-reading";
import { inputClasses, labelClasses } from "@/components/recipient-field-styles";
import {
  hasHan,
  overrideReadings,
  readingText,
  type Readings,
} from "@/lib/readings";
import { cn } from "@/lib/utils";
import { READING_MAX, type ReadingField as Field } from "@/lib/validation/contact";

export function ReadingField({
  field,
  personName,
  defaultValue,
  generated,
  error,
}: {
  field: Field;
  personName: string;
  defaultValue: string;
  generated: Readings;
  error?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  if (!hasHan(personName) && value === "") return null;

  const suggestion = readingText(personName, generated);
  const readings = { ...generated, ...overrideReadings({ name: personName, reading: value }) };
  const hintId = `${field}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={field} className={labelClasses}>
        Reading (pinyin)
      </label>
      <input
        id={field}
        name={field}
        type="text"
        maxLength={READING_MAX}
        value={value}
        placeholder={suggestion ?? undefined}
        onChange={(event) => setValue(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hintId, error && `${field}-error`)}
        className={cn(inputClasses, "min-w-0", error && "border-red-400 dark:border-red-800")}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        {suggestion ? (
          <>
            Suggested: {suggestion}.{" "}
            {value.trim() !== "" && value.trim() !== suggestion ? (
              <>
                Your version is used everywhere you see this name.{" "}
                <button
                  type="button"
                  onClick={() => setValue(suggestion)}
                  className="font-medium text-foreground/80 underline underline-offset-2 hover:text-foreground"
                >
                  Use suggestion
                </button>
              </>
            ) : (
              "Type a different reading to correct it."
            )}
          </>
        ) : (
          "Save the name to see a suggested reading."
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        Readings are only for you. Recipients and printed envelopes never show them.
      </p>
      {error ? (
        <p id={`${field}-error`} className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {hasHan(personName) ? (
        <p className="flex items-baseline gap-2 text-sm text-muted-foreground">
          Preview:
          <NameWithReading
            text={personName}
            readings={readings}
            className="text-lg text-foreground"
          />
        </p>
      ) : null}
    </div>
  );
}
