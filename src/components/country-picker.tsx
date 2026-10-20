"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { countryKey } from "@/lib/address/aliases";
import { aliasesFor, COUNTRY_OPTIONS, countryCodeFor, countryName } from "@/lib/address/countries";

type Option = { code: string; name: string };

const ALL = COUNTRY_OPTIONS.map(([code, name]) => ({
  option: { code, name } as Option,
  code: code.toLowerCase(),
  name: countryKey(name),
  words: countryKey(name).split(" "),
  aliases: aliasesFor(code).map(countryKey),
}));

export function filterCountries(query: string): Option[] {
  const key = countryKey(query);
  if (key === "") return ALL.map((entry) => entry.option);
  const ranked: [number, Option][] = [];
  for (const entry of ALL) {
    const rank =
      entry.code === key || entry.name === key || entry.aliases.includes(key)
        ? 0
        : entry.name.startsWith(key)
          ? 1
          : entry.aliases.some((alias) => alias.startsWith(key))
            ? 2
            : entry.words.some((word) => word.startsWith(key))
              ? 3
              : entry.name.includes(key)
                ? 4
                : -1;
    if (rank >= 0) ranked.push([rank, entry.option]);
  }
  return ranked
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
    .map(([, option]) => option);
}

type CountryPickerProps = {
  id: string;
  name: string;
  value: string;
  onChange: (code: string) => void;
  className: string;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  onUnmatchedChange?: (text: string | null) => void;
};

export function CountryPicker({
  id,
  name,
  value,
  onChange,
  className,
  invalid,
  describedBy,
  placeholder = "Start typing a country",
  onUnmatchedChange,
}: CountryPickerProps) {
  const listId = `${useId()}-countries`;
  const errorId = `${id}-unmatched`;
  const [query, setQuery] = useState<string | null>(null);
  const [unmatched, setUnmatchedState] = useState<string | null>(null);
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

  function setUnmatched(next: string | null) {
    setUnmatchedState(next);
    onUnmatchedChange?.(next);
  }

  function show() {
    const selected = query === null ? options.findIndex((option) => option.code === value) : 0;
    setActive(Math.max(selected, 0));
    setOpen(true);
  }

  function commit(code: string) {
    setQuery(null);
    setOpen(false);
    setUnmatched(null);
    if (code !== value) onChange(code);
  }

  function settle() {
    if (query !== null && query.trim() === "") return commit("");
    if (activeOption) return commit(activeOption.code);
    setOpen(false);
    if (query === null) return;
    const pick = countryCodeFor(query) ?? options[0]?.code;
    if (pick) commit(pick);
    else setUnmatched(query.trim());
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
          setUnmatched(null);
          setOpen(false);
        }
        break;
      case "Tab":
        settle();
        break;
    }
  }

  const described = [describedBy, unmatched ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${listId}-${activeOption.code}` : undefined}
        aria-invalid={invalid || unmatched !== null || undefined}
        aria-describedby={described || undefined}
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
        className={`${className} w-full pr-9 ${unmatched ? "border-destructive" : ""}`}
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
        className="absolute top-0 right-0 flex h-full max-h-11 w-9 items-center justify-center text-muted-foreground"
      >
        <ChevronDown aria-hidden="true" className="size-4" />
      </button>
      <input type="hidden" name={name} value={value} />
      <span className="sr-only" aria-live="polite">
        {open && query !== null
          ? options.length === 1
            ? "1 country"
            : `${options.length} countries`
          : ""}
      </span>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Countries"
        hidden={!open || options.length === 0}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg"
      >
        {options.map((option, i) => (
          <li
            key={option.code}
            id={`${listId}-${option.code}`}
            data-index={i}
            role="option"
            aria-selected={i === active}
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
        ))}
      </ul>
      {open && options.length === 0 ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg">
          No country matches “{query}”.
        </div>
      ) : null}
      {unmatched ? (
        <p id={errorId} className="mt-1.5 text-xs text-destructive">
          No country matches “{unmatched}”. Pick one from the list.
        </p>
      ) : null}
    </div>
  );
}
