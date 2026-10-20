import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  clearRateLimits,
  getContactPostalCode,
  getUserIdByEmail,
  seedBook,
  seedContact,
} from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("agents-owner");
// Set to save the design-comparison screenshots (1280 and 390, light and dark).
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
  const preview = await toolResult("preview_bulk_update", {
    changes: [
      { id: adaId, fields: { country: "GB" } },
      { id: priyaId, fields: { partner_email: "daniel@okafor.test" } },
    ],
  });
  expect(preview.count).toBe(2);
  await toolResult("apply_bulk_update", { preview_id: preview.preview_id });
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
  await expect(feed.getByText("Bulk: 2 contacts")).toBeVisible();

  await shoot("desktop-light", { width: 1280, dark: false });
  await shoot("desktop-dark", { width: 1280, dark: true });
  await shoot("phone-light", { width: 390, dark: false });
  await shoot("phone-dark", { width: 390, dark: true });
  if (screenshotDir) {
    await page.getByRole("tab", { name: "Connect" }).click();
    await shoot("phone-connect-light", { width: 390, dark: false });
    await page.getByRole("tab", { name: "Recent changes" }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
  }

  await feed.getByText("See all").click();
  await expect(feed.getByText("Country United Kingdom → GB")).toBeVisible();

  // Ada's bulk edit is still current; Priya's partner email too.
  await expect(
    feed.getByRole("button", { name: "Undo Country United Kingdom → GB for Ada Lovelace" }),
  ).toBeEnabled();

  await postal.getByRole("button", { name: /^Undo/ }).click();
  await expect(postal).toContainText("Already undone");
  await expect(postal.getByRole("button", { name: /^Undo/ })).toBeDisabled();
  expect(await getContactPostalCode(hollowayId)).toBe("97211");

  await page.goto(`/dashboard/contacts/${hollowayId}`);
  await expect(page.getByText("Agent: Claude Code on MacBook")).toBeVisible();
  await page.goto("/dashboard/agents");
});

test("revokes a token after a confirm, and the agent loses access", async () => {
  await page.getByRole("button", { name: "Revoke Claude Code on MacBook" }).click();
  await expect(page.getByText("Revoke Claude Code on MacBook?")).toBeVisible();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.getByText("No agents connected yet.")).toBeVisible();
  expect((await callTool("book_summary", {})).status).toBe(401);
});
