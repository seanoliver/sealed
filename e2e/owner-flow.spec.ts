import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { cleanupUser, seedOwnerBook } from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

/**
 * The owner's whole happy path in one serial journey: signup → onboarding →
 * create book → add/edit a contact (audit trail) → export CSV → import CSV →
 * search. Serial because each step builds on the last; the spec owns its
 * user and removes it (and everything cascaded) afterwards.
 */
test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("owner");
const occupiedEmail = uniqueEmail("occupied-owner");
const slug = uniqueSlug("owner-book");
const occupiedSlug = uniqueSlug("occupied-book");

let page: Page;

test.beforeAll(async ({ browser }) => {
  await seedOwnerBook({
    email: occupiedEmail,
    displayName: "Existing Owner",
    slug: occupiedSlug,
  });
  page = await browser.newPage();
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await cleanupUser(occupiedEmail);
  await page.close();
});

test("signs up via magic link and lands on focused onboarding", async () => {
  await signupAndLogin(page, ownerEmail);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Create your address book" }),
  ).toBeVisible();
  await expect(page.getByText("Step 1 of 2")).toBeVisible();
  await expect(page.locator("#display_name")).toHaveValue("");
  await expect(page.locator("#slug")).toHaveValue(ownerEmail.split("@")[0]);
  await expect(page.getByRole("link", { name: "Contacts" })).toHaveCount(0);
});

test("keeps entered details when the chosen link is taken", async () => {
  await page.locator("#display_name").fill("Draft Owner");
  await page.locator("#slug").fill(occupiedSlug);
  await page.getByRole("button", { name: "Continue to preview" }).click();
  await expect(page.getByText("That link name is taken", { exact: true })).toBeVisible();
  await expect(page.getByText("Step 1 of 2")).toBeVisible();
  await expect(page.locator("#display_name")).toHaveValue("Draft Owner");
  await expect(page.locator("#slug")).toHaveValue(occupiedSlug);
});

test("configures a faithful preview and preserves it when going back", async () => {
  await page.locator("#display_name").fill("Draft Owner");
  await page.locator("#slug").fill(slug);
  await page.getByRole("button", { name: "Continue to preview" }).click();
  await expect(page.getByText("Step 2 of 2")).toBeVisible();

  const preview = page.getByRole("region", { name: "Invite page preview" });
  await expect(
    preview.getByRole("heading", {
      name: "Add your address to Draft Owner's address book",
    }),
  ).toBeVisible();
  await expect(preview.locator("#first_name")).toBeDisabled();
  await expect(preview.locator("#last_name")).toBeDisabled();
  await expect(preview.locator("#email")).toBeDisabled();
  await expect(preview.locator("#address_line1")).toBeDisabled();
  await expect(preview.getByRole("button", { name: "Add partner" })).toHaveCount(0);
  await expect(preview.getByRole("button", { name: "Add a child" })).toHaveCount(0);
  await expect(preview.locator("#birthday")).toHaveCount(0);
  await expect(preview.getByRole("button", { name: "Add my details" })).toBeDisabled();

  await page.getByRole("switch", { name: "Partner name" }).check();
  await page.getByRole("switch", { name: "Kids' names" }).check();
  await page.getByRole("switch", { name: "Birthday" }).check();
  await expect(preview.getByRole("button", { name: "Add partner" })).toBeDisabled();
  await expect(preview.getByRole("button", { name: "Add a child" })).toBeDisabled();
  await expect(preview.locator("#birthday")).toBeDisabled();
  await page.getByRole("switch", { name: "Birthday" }).uncheck();
  await expect(preview.locator("#birthday")).toHaveCount(0);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByText("Step 1 of 2")).toBeVisible();
  await expect(page.locator("#display_name")).toHaveValue("Draft Owner");
  await expect(page.locator("#slug")).toHaveValue(slug);

  await page.getByRole("button", { name: "Continue to preview" }).click();
  await expect(page.getByRole("switch", { name: "Partner name" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Kids' names" })).toBeChecked();
});

test("publishes the optional fields selected in the preview", async () => {
  await page.getByRole("button", { name: "Create my address book" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "Your address book" }),
  ).toBeVisible();
  await expect(page.getByText("No contacts yet")).toBeVisible();

  await page.goto(`/b/${slug}`);
  await expect(page.getByRole("button", { name: "Add partner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a child" })).toBeVisible();
  await expect(page.locator("#birthday")).toHaveCount(0);

  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("previews settings changes before publishing them", async ({ browser }) => {
  await page.goto("/dashboard/settings");
  const preview = page.getByRole("region", { name: "Invite page preview" });
  await expect(
    preview.getByRole("heading", {
      name: "Add your address to Draft Owner's address book",
    }),
  ).toBeVisible();

  await page.locator("#display_name").fill("Updated Owner");
  await page.getByRole("switch", { name: "Kids' names" }).uncheck();
  await page.getByRole("switch", { name: "Birthday" }).check();
  await expect(
    preview.getByRole("heading", {
      name: "Add your address to Updated Owner's address book",
    }),
  ).toBeVisible();
  await expect(preview.getByRole("button", { name: "Add a child" })).toHaveCount(0);
  await expect(preview.locator("#birthday")).toBeDisabled();

  const liveContext = await browser.newContext();
  const livePage = await liveContext.newPage();
  await livePage.goto(`/b/${slug}`);
  await expect(
    livePage.getByRole("heading", {
      name: "Add your address to Draft Owner's address book",
    }),
  ).toBeVisible();
  await expect(livePage.getByRole("button", { name: "Add a child" })).toBeVisible();
  await expect(livePage.locator("#birthday")).toHaveCount(0);

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await livePage.reload();
  await expect(
    livePage.getByRole("heading", {
      name: "Add your address to Updated Owner's address book",
    }),
  ).toBeVisible();
  await expect(livePage.getByRole("button", { name: "Add a child" })).toHaveCount(0);
  await expect(livePage.locator("#birthday")).toBeVisible();
  await liveContext.close();
});

test("changing the slug requires acknowledging the link-break warning", async () => {
  await page.goto("/dashboard/settings");
  const save = page.getByRole("button", { name: "Save" });
  const warning = page.getByText(/breaks the old one/);

  // Untouched form: no warning, save enabled.
  await expect(warning).toBeHidden();
  await expect(save).toBeEnabled();

  // Editing the slug surfaces the warning and gates submit on the checkbox.
  await page.locator("#slug").fill(`${slug}-moved`);
  await expect(warning).toBeVisible();
  await expect(save).toBeDisabled();

  // Reverting to the saved slug clears the warning and re-enables save.
  await page.locator("#slug").fill(slug);
  await expect(warning).toBeHidden();
  await expect(save).toBeEnabled();

  // A taken link preserves the edit and leaves the current link live.
  await page.locator("#slug").fill(occupiedSlug);
  await page.getByRole("checkbox", { name: "I understand" }).check();
  await save.click();
  await expect(page.getByText("That link name is taken", { exact: true })).toBeVisible();
  await expect(page.locator("#slug")).toHaveValue(occupiedSlug);
  const currentResponse = await page.request.get(`/b/${slug}`);
  expect(currentResponse.status()).toBe(200);

  // Every subsequent edit rearms acknowledgement before a successful save.
  await page.locator("#slug").fill(`${slug}-moved`);
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox", { name: "I understand" }).check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  // The new link is saved (warning gone against the new baseline).
  await expect(warning).toBeHidden();
  await expect(
    page.getByRole("link", { name: `${process.env.APP_URL}/b/${slug}-moved` }),
  ).toBeVisible();

  const oldResponse = await page.request.get(`/b/${slug}`);
  const newResponse = await page.request.get(`/b/${slug}-moved`);
  expect(oldResponse.status()).toBe(404);
  expect(newResponse.status()).toBe(200);

  // Serial journey: the next step expects to start from the dashboard.
  await page.goto("/dashboard");
});

test("adds a contact via the form", async () => {
  await page.getByRole("link", { name: "Add contact" }).click();
  await expect(page.getByRole("button", { name: "Add partner" })).toBeVisible();
  await page.locator("#first_name").fill("Ada");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText("Add a last name.")).toBeVisible();
  await page.locator("#last_name").fill("Lovelace");
  await page.locator("#email").fill("ada@e2e.test");
  await page.locator("#city").fill("London");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page
      .getByRole("table", { name: "Contacts" })
      .getByRole("link", { name: "Ada Lovelace" }),
  ).toBeVisible();
});

test("edits the contact and the audit trail records the change", async () => {
  await page.getByRole("link", { name: "Ada Lovelace" }).click();
  await expect(page).toHaveURL(/\/dashboard\/contacts\/[0-9a-f-]+$/);
  await expect(page.locator("#first_name")).toHaveValue("Ada");
  await page.getByRole("button", { name: "Add partner" }).click();
  await page.locator("#partner_first").fill("William");
  await page.locator("#partner_last").fill("King");
  await page.getByRole("button", { name: "Add a child" }).click();
  await page.locator("#kid_0_first").fill("Byron");
  await page.locator("#city").fill("Boston");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  await page.reload();
  const history = page.getByRole("region", { name: "History" });
  // Two entries: the create snapshot and the edit diff (newest first).
  await expect(history.locator("li")).toHaveCount(2);
  const latest = history.locator("li").first();
  await expect(latest).toContainText("You");
  await expect(latest.locator("pre")).toContainText('"city"');
  await expect(latest.locator("pre")).toContainText("Boston");
  await expect(latest.locator("pre")).toContainText('"partner_name": "William King"');
  await expect(page.locator("#kid_0_first")).toHaveValue("Byron");
  await expect(page.locator("#kid_0_last")).toHaveValue("Lovelace");

  await page.goto("/dashboard");
  await expect(
    page
      .getByRole("table", { name: "Contacts" })
      .getByRole("link", { name: "Ada Lovelace & William King" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Contacts" }).locator("tbody tr").first(),
  ).toContainText("· 1 kid");
});

test("exports contacts as CSV with the canonical header", async () => {
  await page.goto("/dashboard");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  const csv = readFileSync(await download.path(), "utf8");

  const lines = csv.replace(/^﻿/, "").split("\r\n");
  expect(lines[0]).toBe(
    "full_name,partner_name,kids_names,first_name,last_name," +
      "partner_first_name,partner_last_name,email,birthday,address_line1," +
      "address_line2,city,state_region,postal_code,country,notes",
  );
  expect(lines[1]).toContain(
    "Ada Lovelace,William King,Byron,Ada,Lovelace,William,King,",
  );
  expect(lines[1]).toContain("Ada Lovelace");
  expect(lines[1]).toContain("ada@e2e.test");
  expect(lines[1]).toContain("Boston");
});

test("imports a 3-row CSV through the UI", async () => {
  await page.goto("/dashboard/import");
  const csv = [
    "full_name,email,city",
    "Bea Import,bea@e2e.test,Berlin",
    "Cal Import,cal@e2e.test,Cork",
    "Dot Import,,Dover", // no email — still a valid row
  ].join("\n");
  await page.setInputFiles("#csv-file", {
    name: "contacts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await expect(page.getByText("3 contacts ready")).toBeVisible();
  await page.getByRole("button", { name: "Import 3 contacts" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Imported 3 contacts, skipped 0.",
  );

  await page.goto("/dashboard");
  await expect(
    page.getByRole("table", { name: "Contacts" }).locator("tbody tr"),
  ).toHaveCount(4);
});

test("search filters the list and clears back to all contacts", async () => {
  await page.locator("#q").fill("Ada");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\?q=Ada$/);
  const rows = page.getByRole("table", { name: "Contacts" }).locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Ada Lovelace");

  await page.locator("#q").fill("nobody-matches-this");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(/No contacts match/)).toBeVisible();

  await page.getByRole("link", { name: "Clear search" }).click();
  await expect(rows).toHaveCount(4);
  await expect(page.locator("#q")).toHaveValue("");
});
