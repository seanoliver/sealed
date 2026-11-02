import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  getContactSnapshot,
  getUserIdByEmail,
  seedAgentToken,
  seedBook,
  seedContact,
  seedContactEvent,
} from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

// Set HISTORY_SHOTS to a folder to also save screenshots at phone and desktop widths.
test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("history-owner");
const shots = process.env.HISTORY_SHOTS;
const HIDE_DEV = "nextjs-portal { display: none; }";

let page: Page;
let priyaId: string;
let elenaId: string;
let juneId: string;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signupAndLogin(page, ownerEmail);
  const ownerId = await getUserIdByEmail(ownerEmail);
  const bookId = await seedBook({ ownerId, slug: uniqueSlug("history-book"), displayName: "History Owner" });
  const agentId = await seedAgentToken({ userId: ownerId, name: "Holiday helper" });

  priyaId = await seedContact({
    bookId,
    fullName: "Priya Raman",
    addressLine1: "7 Royal York Crescent",
    city: "Bristol",
    postalCode: "BS8 4JX",
    countryCode: "GB",
    household: { firstName: "Priya", lastName: "Raman" },
  });
  const after = await getContactSnapshot(priyaId);
  const before = { ...after, address_line1: "22 Belgrave Road", postal_code: "BS8 1TH" };
  await seedContactEvent({ contactId: priyaId, source: "owner", diff: { after: { full_name: "Priya Raman" } }, minutesAgo: 600 });
  await seedContactEvent({
    contactId: priyaId,
    source: "agent",
    agentTokenId: agentId,
    diff: { before: { birthday: null }, after: { birthday: "1990-03-14" } },
    minutesAgo: 300,
  });
  await seedContactEvent({
    contactId: priyaId,
    source: "token",
    recipient: "primary",
    diff: { before, after, payload: { address_line1: "7 Royal York Crescent", postal_code: "BS8 4JX" } },
  });

  elenaId = await seedContact({
    bookId,
    fullName: "Elena Rossi",
    addressLine1: "Via Roma 1",
    city: "Milano",
    postalCode: "20121",
    countryCode: "IT",
  });
  const elena = await getContactSnapshot(elenaId);
  await seedContactEvent({ contactId: elenaId, source: "owner", diff: { after: { full_name: "Elena Rossi" } }, minutesAgo: 600 });
  await seedContactEvent({
    contactId: elenaId,
    source: "token",
    recipient: "primary",
    diff: { before: elena, after: elena, payload: {} },
  });

  juneId = await seedContact({ bookId, fullName: "Grandma June" });
});

test.afterAll(async () => {
  await page.close();
});

const history = () => page.getByRole("region", { name: "History" });

async function snap(name: string) {
  if (!shots) return;
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await history().screenshot({ path: path.join(shots, `${name}-${width}.png`), style: HIDE_DEV });
  }
}

test("a recipient's address change lists old and new values by field", async () => {
  await page.goto(`/dashboard/contacts/${priyaId}`);
  const [latest, agent, created] = [0, 1, 2].map((i) => history().locator("li").nth(i));
  await expect(latest).toContainText("Priya, through their link");
  await expect(latest.locator("dt")).toHaveText(["Street address", "Postcode"]);
  await expect(latest.locator("del")).toHaveText(["22 Belgrave Road", "BS8 1TH"]);
  await expect(latest.locator("ins")).toHaveText(["7 Royal York Crescent", "BS8 4JX"]);

  await expect(agent).toContainText("Agent: Holiday helper");
  await expect(agent.locator("dd")).toContainText("none");
  await expect(agent.locator("ins")).toHaveText("Mar 14");

  await expect(created).toContainText("You");
  await expect(created).toContainText("Added this contact");
  await expect(history()).not.toContainText("book_id");
  await expect(history().locator("pre")).toHaveCount(0);
  await snap("address-change");

  if (shots) {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 390, height: 900 });
    await history().screenshot({ path: path.join(shots, "address-change-390-dark.png"), style: HIDE_DEV });
    await page.emulateMedia({ colorScheme: "light" });
  }
});

test("a one-click confirm reads as confirmed with no rows", async () => {
  await page.goto(`/dashboard/contacts/${elenaId}`);
  const latest = history().locator("li").first();
  await expect(latest).toContainText("Elena, through their link");
  await expect(latest.getByText("Confirmed, no changes")).toBeVisible();
  await expect(latest.locator("dl")).toHaveCount(0);
  await snap("confirm");
});

test("recipient-written values render as text, never as HTML", async () => {
  const markup = '<img src=x onerror="document.title=1">';
  const contact = await getContactSnapshot(elenaId);
  await seedContactEvent({
    contactId: elenaId,
    source: "token",
    recipient: "primary",
    diff: { before: contact, after: { ...contact, address_line1: markup }, payload: {} },
  });
  await page.goto(`/dashboard/contacts/${elenaId}`);
  const latest = history().locator("li").first();
  await expect(latest.locator("ins")).toHaveText(markup);
  await expect(history().locator("img")).toHaveCount(0);
});

test("unreadable and undo events read as plain text", async () => {
  const contact = await getContactSnapshot(elenaId);
  await seedContactEvent({
    contactId: elenaId,
    source: "owner",
    diff: { before: { city: "Milano" }, after: { city: "Roma" }, undo_of: "00000000-0000-4000-8000-000000000001" },
    minutesAgo: -1,
  });
  await seedContactEvent({
    contactId: elenaId,
    source: "token",
    recipient: "primary",
    diff: { before: contact, payload: { city: "Torino" } },
    minutesAgo: -2,
  });
  await page.goto(`/dashboard/contacts/${elenaId}`);
  await expect(history().locator("li").first()).toContainText("Details changed");
  await expect(history()).toContainText("Undid an earlier change");
  await expect(history().locator("pre")).toHaveCount(0);
  await expect(history()).not.toContainText("Torino");
});

test("a contact with no history explains what will show", async () => {
  await page.goto(`/dashboard/contacts/${juneId}`);
  await expect(history()).toContainText(
    "No changes yet. Edits by you, your agents, and Grandma will show here.",
  );
  await snap("empty");
});
