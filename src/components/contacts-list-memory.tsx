"use client";

import { useEffect } from "react";

const LIST_PATH = "/dashboard";
const POSITION_KEY = "sealed:contacts-list";
const RESTORE_KEY = "sealed:contacts-list-restore";

type Position = { url: string; y: number };

function read(): Position | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(POSITION_KEY) ?? "null");
    if (typeof saved !== "object" || saved === null) return null;
    const { url, y } = saved as Partial<Position>;
    return typeof url === "string" && url.startsWith(LIST_PATH) && typeof y === "number" ? { url, y } : null;
  } catch {
    return null;
  }
}

function flagged(): boolean {
  try {
    return sessionStorage.getItem(RESTORE_KEY) !== null;
  } catch {
    return false;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {}
}

export function ContactsListMemory({ query }: { query: string }) {
  useEffect(() => {
    const url = query ? `${LIST_PATH}?${new URLSearchParams({ q: query })}` : LIST_PATH;
    const saved = read();
    if (flagged() && saved?.url === url) window.scrollTo(0, saved.y);
    write(RESTORE_KEY, null);
    const save = () => {
      if (window.location.pathname === LIST_PATH) write(POSITION_KEY, JSON.stringify({ url, y: window.scrollY }));
    };
    save();
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [query]);
  return null;
}

export function contactsListUrl(): string {
  return read()?.url ?? LIST_PATH;
}

export function markListRestore() {
  write(RESTORE_KEY, "1");
}
