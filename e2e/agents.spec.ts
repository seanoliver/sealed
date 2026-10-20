import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  clearRateLimits,
  contactExists,
  getContactCity,
  getContactEmails,
  getContactPostalCode,
  getUserIdByEmail,
  seedBook,
  seedContact,
} from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("agents-owner");
const screenshotDir = process.env.AGENTS_SCREENSHOT_DIR;

let page: Page;
let token: string;
let hollowayId: string;
let adaId: string;
let priyaId: string;
let nextId = 1;

async function callTool(name: string, args: object) {
  const response = await page.request.post("/api/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    data: { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } },
  });
  const text = await response.text();
  const line = text.split("\n").find((part) => part.startsWith("data: "));
  return { status: response.status(), body: line ? JSON.parse(line.slice(6)) : null };
}

async function toolResult(name: string, args: object) {
  const { status, body } = await callTool(name, args);
  expect(status, name).toBe(200);
  expect(body.result.isError, body.result.content[0].text).toBeFalsy();
  return JSON.parse(body.result.content[0].text);
}

async function shoot(name: string, { width, dark }: { width: number; dark: boolean }) {
  if (!screenshotDir) return;
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await page.waitForTimeout(400); // let transition-colors settle before the capture
  await page.screenshot({ path: `${screenshotDir}/p109b-${name}.png`, fullPage: true });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await clearRateLimits();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signupAndLogin(page, ownerEmail);
  const bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("agents-book"),
    displayName: "Agents Owner",
  });
  hollowayId = await seedContact({
    bookId,
    fullName: "Jen Holloway",
    email: "jen@holloway.test",
    household: { firstName: "Jen", lastName: "Holloway", partnerFirstName: "Mark", partnerLastName: "Holloway" },
    city: "Portland",
    postalCode: "97211",
  });
  adaId = await seedContact({
    bookId,
    fullName: "Ada Lovelace",
    email: "ada@lovelace.test",
    household: { firstName: "Ada", lastName: "Lovelace" },
    country: "United Kingdom",
  });
  priyaId = await seedContact({
    bookId,
    fullName: "Priya Raman",
    email: "priya@raman.test",
    household: { firstName: "Priya", lastName: "Raman", partnerFirstName: "Daniel", partnerLastName: "Okafor" },
    country: "USA",
  });
});

test.afterAll(async () => {
  await page.close();
  await cleanupUser(ownerEmail);
});

test("creates a token on the Agents page and shows it once", async () => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByRole("heading", { name: "Connect an agent" })).toBeVisible();
  await expect(page.getByText("No agent changes yet.")).toBeVisible();

  await expect(page.getByRole("checkbox", { name: /Look things up/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Fix and fill in/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Email people/ })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Expires" })).toHaveValue("90");

  await page.getByRole("textbox", { name: "2 · Name" }).fill("Claude Code on MacBook");
  await page.getByRole("button", { name: "Create token" }).click();
  const command = page.getByTestId("mcp-command");
  await expect(command).toContainText("claude mcp add --transport http sealed");
  const text = (await command.textContent()) ?? "";
  token = /Bearer (sealed_pat_[A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? "";
  expect(token).not.toBe("");
  expect(text).toContain("/api/mcp");
  await expect(page.getByText(/Claude Code on MacBook/).last()).toBeVisible();
  await expect(page.getByText(/Look up, Fix and fill in · never used · expires in 90 days/)).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("mcp-command")).toHaveCount(0);
  await expect(page.getByText(token)).toHaveCount(0);
});

test("shows agent edits in the feed and undoes one", async () => {
  await toolResult("update_contact", { id: adaId, fields: { country: "Ireland" } });
  const edit = await toolResult("update_contact", {
    id: hollowayId,
    fields: { postal_code: "97211-3417" },
  });
  expect(edit.event_id).toEqual(expect.any(String));

  await page.reload();
  const feed = page.getByRole("region", { name: "Recent agent changes" });
  const postal = feed.getByRole("listitem").filter({ hasText: "Postal code 97211 → 97211-3417" });
  await expect(postal).toContainText("Jen & Mark Holloway");
  await expect(postal).toContainText("Claude Code on MacBook");
  await expect(feed.getByText("Country United Kingdom → Ireland")).toBeVisible();

  await postal.getByRole("button", { name: /^Undo/ }).click();
  await expect(postal).toContainText("Already undone");
  await expect(postal.getByRole("button", { name: /^Undo/ })).toBeDisabled();
  expect(await getContactPostalCode(hollowayId)).toBe("97211");

  await page.goto(`/dashboard/contacts/${hollowayId}`);
  await expect(page.getByText("Agent: Claude Code on MacBook")).toBeVisible();
});

test("refuses a contact form saved after an agent changed the contact", async () => {
  await page.goto(`/dashboard/contacts/${hollowayId}`);
  await page.getByLabel("City").fill("Salem");
  await toolResult("update_contact", { id: hollowayId, fields: { city: "Eugene" } });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("This contact changed since you opened it. Reload to see the latest."),
  ).toBeVisible();
  expect((await getContactCity(hollowayId))).toBe("Eugene");
  await page.goto("/dashboard/agents");
});

const waiting = () => page.getByRole("list", { name: "Waiting for you" });

async function requestDeletion(ids: string[]) {
  const preview = await toolResult("preview_delete_contacts", { ids });
  const asked = await toolResult("request_delete_contacts", { preview_id: preview.preview_id });
  expect(asked.status).toBe("pending");
}

test("an agent's email change waits for the owner, who can discard or approve it", async () => {
  const queued = await toolResult("update_contact", {
    id: priyaId,
    fields: { email: "priya@new.test" },
  });
  expect(queued.pending_email_change.message).toContain("waiting for the owner");
  expect((await getContactEmails(priyaId)).email).toBe("priya@raman.test");

  await toolResult("update_contact", { id: adaId, fields: { first_name: "Augusta" } });
  await requestDeletion([adaId]);

  await page.reload();
  const email = waiting().getByRole("listitem").filter({ hasText: "Email change" });
  await expect(email).toContainText("Email change: Priya Raman & Daniel Okafor");
  await expect(email).toContainText("Email: priya@raman.test → priya@new.test");
  const deletion = waiting().getByRole("listitem").filter({ hasText: "Pending deletion" }).first();
  await expect(deletion).toContainText("This agent edited this contact before asking.");
  await expect(deletion.getByText("ada@lovelace.test")).toBeVisible();

  await shoot("desktop-light", { width: 1280, dark: false });
  await shoot("desktop-dark", { width: 1280, dark: true });
  await shoot("phone-light", { width: 390, dark: false });
  await shoot("phone-dark", { width: 390, dark: true });
  await shoot("pending-desktop-light", { width: 1280, dark: false });
  await shoot("pending-desktop-dark", { width: 1280, dark: true });
  await shoot("pending-phone-light", { width: 390, dark: false });
  await shoot("pending-phone-dark", { width: 390, dark: true });
  if (screenshotDir) {
    await page.getByRole("tab", { name: "Connect" }).click();
    await shoot("phone-connect-light", { width: 390, dark: false });
    await page.getByRole("tab", { name: /Recent changes/ }).click();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });

  await email.getByRole("button", { name: "Discard" }).click();
  await expect(waiting().getByText("Email change")).toHaveCount(0);
  expect((await getContactEmails(priyaId)).email).toBe("priya@raman.test");

  await toolResult("update_contact", { id: priyaId, fields: { email: "priya@new.test" } });
  await page.reload();
  const again = waiting().getByRole("listitem").filter({ hasText: "Email change" });
  await again.getByRole("button", { name: "Change email" }).click();
  const yes = again.getByRole("button", { name: "Yes, change it" });
  await expect(yes).toBeFocused();
  await again.getByRole("button", { name: "Cancel" }).click();
  await expect(again.getByRole("button", { name: "Change email" })).toBeFocused();
  await again.getByRole("button", { name: "Change email" }).click();
  await again.getByRole("button", { name: "Yes, change it" }).click();
  await expect(waiting().getByText("Email change")).toHaveCount(0);
  expect((await getContactEmails(priyaId)).email).toBe("priya@new.test");
  await expect(page.getByText("Email priya@raman.test → priya@new.test")).toBeVisible();
});

test("an agent's delete waits for the owner, who can discard or approve it", async () => {
  const deletion = waiting().getByRole("listitem").filter({ hasText: "Pending deletion" });
  await deletion.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Pending deletion")).toHaveCount(0);
  expect(await contactExists(adaId)).toBe(true);

  await requestDeletion([priyaId]);
  await page.reload();
  const pending = waiting().getByRole("listitem").filter({ hasText: "Pending deletion" });
  const trigger = pending.getByRole("button", { name: "Delete 1 contact" });
  await trigger.click();
  await expect(pending).toContainText("Delete 1 contact for good?");
  await expect(pending.getByRole("button", { name: "Yes, delete" })).toBeFocused();
  await pending.getByRole("button", { name: "Cancel" }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await pending.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("Pending deletion")).toHaveCount(0);
  await expect(page.getByText("Deleted 1 contact")).toBeVisible();
  expect(await contactExists(priyaId)).toBe(false);
});

test("revokes a token after a confirm, and the agent loses access", async () => {
  const revoke = page.getByRole("button", { name: "Revoke Claude Code on MacBook" });
  await revoke.click();
  await expect(page.getByText("Revoke Claude Code on MacBook?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(revoke).toBeFocused();
  await revoke.click();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.getByText("No agents connected yet.")).toBeVisible();
  expect((await callTool("book_summary", {})).status).toBe(401);
});
