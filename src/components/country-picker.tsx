"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { countryKey } from "@/lib/address/aliases";
import { aliasesFor, COUNTRY_OPTIONS, countryCodeFor, countryName } from "@/lib/address/countries";

type Option = { code: string; name: string };

const ALL: Option[] = COUNTRY_OPTIONS.map(([code, name]) => ({ code, name }));

/** Countries matching what was typed: code, then name, alias and word starts, then anywhere in the name. */
export function filterCountries(query: string): Option[] {
  const key = countryKey(query);
  if (key === "") return ALL;
  const ranked: [number, Option][] = [];
  for (const option of ALL) {
    const name = countryKey(option.name);
    const aliases = aliasesFor(option.code).map(countryKey);
    const rank =
      option.code.toLowerCase() === key || name === key || aliases.includes(key)
        ? 0
        : name.startsWith(key)
          ? 1
          : aliases.some((alias) => alias.startsWith(key))
            ? 2
            : name.split(" ").some((word) => word.startsWith(key))
              ? 3
              : name.includes(key)
                ? 4
                : -1;
    if (rank >= 0) ranked.push([rank, option]);
  }
  return ranked
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
    .map(([, option]) => option);
}

type CountryPickerProps = {
  id: string;
  /** The hidden input's name; it posts the two-letter code. */
  name: string;
  value: string;
  onChange: (code: string) => void;
  className: string;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
};

/**
 * Type-to-filter country picker (ARIA combobox with a listbox popup). Matches
 * English names, short forms like UK and USA, and two-letter codes.
 */
export function CountryPicker({
  id,
  name,
  value,
  onChange,
  className,
  invalid,
  describedBy,
  placeholder = "Start typing a country",
}: CountryPickerProps) {
  const listId = `${useId()}-countries`;
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => filterCountries(query ?? ""), [query]);
  const text = query ?? (value ? countryName(value) : "");
  const activeOption = open ? options[active] : undefined;

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function show() {
    const selected = query === null ? options.findIndex((option) => option.code === value) : 0;
    setActive(Math.max(selected, 0));
    setOpen(true);
  }

  function commit(code: string) {
    setQuery(null);
    setOpen(false);
    if (code !== value) onChange(code);
  }

  function settle() {
    if (query !== null) {
      const exact = countryCodeFor(query);
      if (exact) commit(exact);
      else if (query.trim() === "") commit("");
      else setQuery(null);
    }
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) show();
        else setActive((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) show();
        else setActive((i) => Math.max(i - 1, 0));
        break;
      case "Home":
      case "End":
        if (open) {
          event.preventDefault();
          setActive(event.key === "Home" ? 0 : options.length - 1);
        }
        break;
      case "Enter":
        if (open && activeOption) {
          event.preventDefault();
          commit(activeOption.code);
        }
        break;
      case "Escape":
        if (open || query !== null) {
          event.preventDefault();
          event.stopPropagation();
          setQuery(null);
          setOpen(false);
        }
        break;
      case "Tab":
        if (open && query !== null && activeOption) commit(activeOption.code);
        else settle();
        break;
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${listId}-${activeOption.code}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onClick={() => (open ? null : show())}
        onBlur={settle}
        onKeyDown={onKeyDown}
        className={`${className} w-full pr-9`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show countries"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          inputRef.current?.focus();
          if (open) setOpen(false);
          else show();
        }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground"
      >
        <ChevronDown aria-hidden="true" className="size-4" />
      </button>
      <input type="hidden" name={name} value={value} />
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Countries"
        hidden={!open}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg"
      >
        {options.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">No country matches “{query}”.</li>
        ) : (
          options.map((option, i) => (
            <li
              key={option.code}
              id={`${listId}-${option.code}`}
              data-index={i}
              role="option"
              aria-selected={option.code === value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => commit(option.code)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
                i === active ? "bg-accent text-accent-foreground" : ""
              } ${option.code === value ? "font-medium" : ""}`}
            >
              <span>{option.name}</span>
              <span className="text-xs text-muted-foreground">{option.code}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
