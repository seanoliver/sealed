import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@/lib/db/admin";
import {
  getPublicBook,
  isBookSlugAvailable,
  SLUG_SHAPE,
} from "./public-book";

// Fixed ids keep re-runs idempotent (same pattern as rls.test.ts).
const U1 = "00000000-0000-0000-0000-00000000c001";
const B1 = "10000000-0000-0000-0000-00000000c001";
const SLUG = "public-book-test";

describe("SLUG_SHAPE", () => {
  it("accepts valid slugs and rejects malformed ones", () => {
    expect(SLUG_SHAPE.test("abc")).toBe(true);
    expect(SLUG_SHAPE.test("my-book-2")).toBe(true);
    expect(SLUG_SHAPE.test("a".repeat(63))).toBe(true);
    expect(SLUG_SHAPE.test("ab")).toBe(false); // too short
    expect(SLUG_SHAPE.test("a".repeat(64))).toBe(false); // too long
    expect(SLUG_SHAPE.test("UPPER")).toBe(false);
    expect(SLUG_SHAPE.test("-starts-with-hyphen")).toBe(false);
    expect(SLUG_SHAPE.test("has space")).toBe(false);
    expect(SLUG_SHAPE.test("semi;colon")).toBe(false);
    expect(SLUG_SHAPE.test("")).toBe(false);
  });
});

describe("getPublicBook", () => {
  beforeAll(async () => {
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U1}, 'publicbook@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      update public.profiles set display_name = 'Public Owner' where id = ${U1}`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug, enabled_fields)
      values (${B1}, ${U1}, ${SLUG},
              '{"partner_name": true, "kids_names": false, "birthday": true}')
      on conflict (id) do update set slug = excluded.slug,
        enabled_fields = excluded.enabled_fields`);
  });

  it("returns EXACTLY ownerName, enabledFields and senderCountry — nothing else", async () => {
    const book = await getPublicBook(SLUG);
    expect(book).not.toBeNull();
    // Key-set assertion: a widened select (id, counts, ...) fails here.
    expect(Object.keys(book!).sort()).toEqual(["enabledFields", "ownerName", "senderCountry"]);
    expect(book).toEqual({
      ownerName: "Public Owner",
      enabledFields: { partner_name: true, kids_names: false, birthday: true },
      senderCountry: "US",
    });
  });

  it("reports public link availability without returning book data", async () => {
    await expect(isBookSlugAvailable(SLUG)).resolves.toBe(false);
    await expect(isBookSlugAvailable("available-book-link")).resolves.toBe(true);
    await expect(isBookSlugAvailable("Bad Link")).resolves.toBe(false);
  });

  it("returns null for an unknown slug", async () => {
    expect(await getPublicBook("no-such-book-ever")).toBeNull();
  });

  it("returns null for malformed slugs without querying", async () => {
    // Includes an injection-shaped probe: it must fail the shape gate.
    for (const bad of ["UPPER!", "ab", "x' or '1'='1", "a".repeat(64)]) {
      expect(await getPublicBook(bad)).toBeNull();
    }
  });
});
