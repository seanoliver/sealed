import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { cleanupUser, seedContact, seedOwnerBook, seedUpdateToken } from "./db";
import { signupAndLogin, stubTurnstile, uniqueEmail, uniqueSlug } from "./helpers";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const ownerEmail = uniqueEmail("shared-owner");
const memberEmail = uniqueEmail("shared-member");
let bookId: string;
let token: string;

test.beforeAll(async () => {
  ({ bookId } = await seedOwnerBook({
    email: ownerEmail,
    displayName: "Sean & Tina",
    slug: uniqueSlug("shared"),
  }));
  const contactId = await seedContact({
    bookId,
    fullName: "Ada Lovelace",
    email: uniqueEmail("shared-ada"),
    addressLine1: "1427 Linden Avenue",
    city: "Portland",
    stateRegion: "OR",
    postalCode: "97214",
    countryCode: "US",
    household: { firstName: "Ada", lastName: "Lovelace" },
  });
  token = await seedUpdateToken(contactId);
  await db`insert into public.book_members (book_id, email) values (${bookId}, ${memberEmail})`;
});

test.afterAll(async () => {
  await cleanupUser(memberEmail);
  await cleanupUser(ownerEmail);
  await db.end();
});

test("a recipient of a couple's book reads plural copy", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${token}`);
  await expect(page.getByRole("region", { name: "Envelope preview" })).toContainText(
    "No country line: Sean & Tina mail from the US.",
  );
  await page.getByText("Why am I getting this?").click();
  await expect(page.getByText("Sean & Tina are collecting addresses for holiday cards")).toBeVisible();
  await expect(page.getByText("Only Sean & Tina see what you enter.")).toBeVisible();
});

test("the confirm page names every sender as who sees the reply", async ({ page }) => {
  await db`update public.books set sender_full_names = 'Sean Oliver & Tina Oliver' where id = ${bookId}`;
  await stubTurnstile(page);
  await page.goto(`/u/${token}/confirm`);
  await expect(
    page.getByText("Only Sean Oliver & Tina Oliver see what you enter. It isn't sold or shared."),
  ).toBeVisible();
});

test("an invited member lands in the shared book and cannot edit its settings", async ({ page }) => {
  await signupAndLogin(page, memberEmail);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Ada Lovelace").first()).toBeVisible();
  await page.goto("/dashboard/settings");
  await expect(page.getByText("This address book is shared with you.")).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveCount(0);
});
