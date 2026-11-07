import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { cleanupUser, clearRateLimits } from "./db";
import { createBook, signupAndLogin, uniqueEmail, uniqueSlug, waitForTurnstile } from "./helpers";

/**
 * Detected duplicates: the owner sees pairs on Review, resolves them, and meets
 * the same flag at import, manual add and send. Set SCREENSHOT_DIR to also save
 * the screens the PR shows, at phone and desktop width.
 */
test.describe.configure({ mode: "serial" });

const db = postgres(process.env.DATABASE_URL!, { max: 1 });
const ownerEmail = uniqueEmail("duplicates-owner");
const slug = uniqueSlug("duplicates");
const shotDir = process.env.SCREENSHOT_DIR;

let page: Page;
let bookId: string;

async function shot(name: string) {
  if (!shotDir) return;
  mkdirSync(shotDir, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  for (const [width, label] of [[1280, "desktop"], [390, "phone"]] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator("main").screenshot({ path: path.join(shotDir, `${name}-${label}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function seed(fullName: string, partnerName: string | null, fields: Record<string, string> = {}) {
  const id = randomUUID();
  await db`insert into public.contacts ${db({
    id,
    book_id: bookId,
    full_name: fullName,
    partner_name: partnerName,
    ...fields,
  })}`;
  return id;
}

test.beforeAll(async ({ browser }) => {
  await clearRateLimits();
  page = await (await browser.newContext({ deviceScaleFactor: shotDir ? 2 : 1 })).newPage();
  await signupAndLogin(page, ownerEmail);
  await createBook(page, { displayName: "Theo", slug });
  const [book] = await db`select id from public.books where slug = ${slug}`;
  bookId = book.id as string;
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await db.end();
});

test("shows nothing to review on an empty book", async () => {
  await page.goto("/dashboard/review");
  await expect(page.getByText("No duplicates detected.")).toBeVisible();
  await shot("empty");
});

test("flags the same couple in either order, and counts them in the nav", async () => {
  await seed("Theo Marsh", "Nina Marsh", {
    email: "theo@dup.test",
    address_line1: "88 Example Way",
    city: "Springfield",
  });
  await seed("Nina Marsh", "Theo Marsh", { email: "nina@dup.test", birthday: "1980-06-15" });
  await seed("Maya Chen", null, { city: "Brooklyn" });
  await seed("Maya Chen", "Jordan Lee", { email: "maya@dup.test", city: "San Francisco" });
  await page.goto("/dashboard/review");
  await expect(page.getByRole("heading", { name: "Detected duplicates · 2" })).toBeVisible();
  await expect(page.getByText("Same people", { exact: true })).toBeVisible();
  await expect(page.getByText("Might be the same people")).toBeVisible();
  await expect(page.getByRole("link", { name: "Review 2 waiting" })).toBeVisible();
  await shot("review-filled");
});

test("warns before one household gets two requests", async () => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Send to all shown" }).click();
  await expect(page.getByText("1 detected duplicate could get two requests.")).toBeVisible();
  await shot("send-warning");
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("Not duplicates removes a pair and keeps both contacts", async () => {
  await page.goto("/dashboard/review");
  const card = page.getByRole("listitem").filter({ hasText: "Might be the same people" });
  await card.getByRole("button", { name: "Not duplicates" }).click();
  await expect(page.getByRole("heading", { name: "Detected duplicates · 1" })).toBeVisible();
  const rows = await db`select id from public.contacts where book_id = ${bookId} and full_name = 'Maya Chen'`;
  expect(rows).toHaveLength(2);
});

test("deleting one contact from its page clears the pair", async () => {
  const card = page.getByRole("listitem").filter({ hasText: "Same people" });
  await card.getByRole("link", { name: "Nina & Theo Marsh" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete contact" }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.goto("/dashboard/review");
  await expect(page.getByText("No duplicates detected.")).toBeVisible();
});

test("adding a contact saves it and points at the match", async () => {
  await page.goto("/dashboard/contacts/new");
  await page.getByLabel("First name").first().fill("Ana");
  await page.getByLabel("Last name").first().fill("Ruiz");
  await page.getByRole("button", { name: /save|add contact/i }).click();
  await page.waitForURL(/\/dashboard\?added=/);
  await seed("Ana Ruiz", null);
  await page.goto("/dashboard/contacts/new");
  await page.getByLabel("First name").first().fill("Ana");
  await page.getByLabel("Last name").first().fill("Ruiz");
  await page.getByRole("button", { name: /save|add contact/i }).click();
  await expect(page.getByRole("status").getByText("This may be the same people as Ana Ruiz.")).toBeVisible();
  await shot("manual-add");
});

test("import asks what to do with rows already in the book", async () => {
  await page.goto("/dashboard/import");
  await page.getByLabel("CSV file").setInputFiles({
    name: "contacts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,Spouse,City\nMarsh Nina,,Seattle\nNina Marsh,Theo Marsh,Seattle\nBen Park,,Reno\n"),
  });
  await expect(page.getByText("1 row matches people already in your book")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import 3 contacts" })).toBeVisible();
  await shot("import-choice");
  await page.getByLabel(/Leave it out/).check();
  await page.getByRole("button", { name: "Import 2 contacts" }).click();
  await expect(page.getByText("Imported 2 contacts, skipped 1")).toBeVisible();
  const [row] = await db`
    select count(*)::int as n from public.contacts where book_id = ${bookId} and full_name = 'Nina Marsh'`;
  expect(row.n).toBe(0);
});

test("an invite reply matched by name reaches only the owner, and keeps the stored email", async ({ browser }) => {
  await db`update public.contacts set partner_name = null where book_id = ${bookId} and email = 'theo@dup.test'`;
  await db`delete from public.contacts where book_id = ${bookId} and full_name in ('Ana Ruiz', 'Marsh Nina', 'Ben Park')`;
  const visitor = await (await browser.newContext()).newPage();

  const responses: string[] = [];
  const submit = async (first: string, last: string, email: string) => {
    await visitor.goto(`/b/${slug}`);
    await visitor.locator("#first_name").fill(first);
    await visitor.locator("#last_name").fill(last);
    await visitor.locator("#email").fill(email);
    await waitForTurnstile(visitor);
    await visitor.getByRole("button", { name: "Add my details" }).click();
    await visitor.waitForURL(/\/thanks$/);
    responses.push(await visitor.locator("main").innerText());
  };
  await submit("Theo", "Marsh", "someone-else@dup.test");
  await submit("Nobody", "Known", "nobody@dup.test");
  expect(responses[0]).toBe(responses[1]);

  await page.goto("/dashboard/review");
  await expect(page.getByText("Possible match by name:")).toBeVisible();
  await shot("invite-match");
  await page.getByRole("link", { name: "Compare" }).click();
  await expect(page.getByText("Any email in this reply is ignored.")).toBeVisible();
  await expect(page.getByText("someone-else@dup.test")).toHaveCount(0);
  await shot("invite-compare");
  await page.getByRole("button", { name: "Apply update" }).click();
  await expect(page.getByText("Matched by name only")).toHaveCount(0);
  const [row] = await db`select email from public.contacts where book_id = ${bookId} and full_name = 'Theo Marsh'`;
  expect(row.email).toBe("theo@dup.test");
});
