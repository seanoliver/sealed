import { expect, test, type Page, type Route } from "@playwright/test";
import {
  cleanupUser,
  deleteContact,
  getContactNamesByEmail,
  getContactRow,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedEmailSend,
  seedOwnerBook,
  setContactCity,
  setContactKidsByEmail,
} from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("sheet-owner");
const strangerEmail = uniqueEmail("sheet-stranger");

let page: Page;
let adaId: string;
let beaId: string;
let strangerContactId: string;
let bookId: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  page = await browser.newPage();
  await signupAndLogin(page, ownerEmail);
  bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("sheet-book"),
    displayName: "Sheet Owner",
  });
  adaId = await seedContact({
    bookId,
    fullName: "Ada Lovelace",
    email: "ada@example.test",
    kidsNames: "Byron",
    addressLine1: "12 St James's Square",
    city: "London",
    stateRegion: "Greater London",
    postalCode: "SW1Y 4JH",
  });
  beaId = await seedContact({
    bookId,
    fullName: "Bea Brown",
    email: "bea@example.test",
  });
  await seedEmailSend({ contactId: beaId, bookId, resendId: `re_${beaId}` });
  await seedContact({ bookId, fullName: "Cole Abernathy", city: "Austin" });
  const stranger = await seedOwnerBook({
    email: strangerEmail,
    displayName: "Stranger",
    slug: uniqueSlug("sheet-stranger"),
  });
  strangerContactId = await seedContact({
    bookId: stranger.bookId,
    fullName: "Zed Stranger",
    city: "Berlin",
  });
  // Compile the contact page up front; a cold dev compile outlasts toHaveValue.
  await page.request.get(`/dashboard/contacts/${adaId}`);
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await cleanupUser(strangerEmail);
  await page.close();
});

async function openDashboard() {
  await page.goto("/dashboard");
  await page.waitForFunction(() => {
    const el = document.querySelector('table[aria-label="Contacts"]');
    return (
      el !== null && Object.keys(el).some((k) => k.startsWith("__reactFiber"))
    );
  });
}

function table() {
  return page.getByRole("table", { name: "Contacts" });
}

function bodyRow(name: string) {
  return table().locator("tbody tr").filter({ hasText: name });
}

test("sorts by a column with empty values last", async () => {
  await openDashboard();
  const city = table().getByRole("columnheader", { name: "City" });
  await city.getByRole("button").click();
  await expect(city).toHaveAttribute("aria-sort", "ascending");
  await expect(table().locator("tbody tr")).toHaveText([
    /Cole Abernathy/,
    /Ada Lovelace/,
    /Bea Brown/,
  ]);

  await city.getByRole("button").click();
  await expect(city).toHaveAttribute("aria-sort", "descending");
  await expect(table().locator("tbody tr")).toHaveText([
    /Ada Lovelace/,
    /Cole Abernathy/,
    /Bea Brown/,
  ]);
});

test("arrow keys move between rows and Space selects", async () => {
  await openDashboard();
  await bodyRow("Ada Lovelace").locator("td").nth(3).click();
  await expect(bodyRow("Ada Lovelace")).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(bodyRow("Bea Brown")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(table().getByLabel("Select Bea Brown")).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Request addresses (1)" }),
  ).toBeVisible();

  await page.keyboard.press("ArrowDown");
  await expect(bodyRow("Cole Abernathy")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(table().getByLabel("Select Cole Abernathy")).not.toBeChecked();

  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(table().getByLabel("Select Bea Brown")).not.toBeChecked();

  await bodyRow("Ada Lovelace").locator("td").nth(3).click();
  await page.keyboard.press("End");
  await expect(bodyRow("Cole Abernathy")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(bodyRow("Ada Lovelace")).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect(bodyRow("Cole Abernathy")).toBeFocused();
  await page.keyboard.press("PageUp");
  await expect(bodyRow("Ada Lovelace")).toBeFocused();
});

test("the header checkbox selects every contact with an email", async () => {
  await openDashboard();
  await table().getByLabel("Select all contacts with an email").check();
  await expect(
    page.getByRole("button", { name: "Request addresses (2)" }),
  ).toBeVisible();
  await expect(table().getByLabel("Select Cole Abernathy")).not.toBeChecked();
});

test("the Region and Postal code columns show stored values", async () => {
  await openDashboard();
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Region" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Postal code" }).click();
  await page.keyboard.press("Escape");
  await expect(bodyRow("Ada Lovelace")).toContainText("Greater London");
  await expect(bodyRow("Ada Lovelace")).toContainText("SW1Y 4JH");

  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Region" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Postal code" }).click();
  await page.keyboard.press("Escape");
});

test("a send that fails to reach the server says so", async () => {
  await openDashboard();
  await page.route("**/dashboard", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await page.getByRole("button", { name: "Send to all shown" }).click();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.getByText("Couldn't send.")).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
});

test("Enter edits the row in place and keeps fields the row does not show", async () => {
  await openDashboard();
  await bodyRow("Ada Lovelace").locator("td").nth(3).click();
  await page.keyboard.press("Enter");

  const row = table()
    .locator("tbody tr")
    .filter({ has: page.getByRole("textbox") });
  await expect(row.getByRole("button", { name: /Ada Lovelace/ })).toBeFocused();
  await row.getByRole("textbox", { name: "City" }).fill("Paris");
  await page.keyboard.press("Enter");

  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(bodyRow("Ada Lovelace")).toContainText("Paris");
  await expect(bodyRow("Ada Lovelace")).toBeFocused();

  await page.goto(`/dashboard/contacts/${adaId}`);
  await expect(page.locator("#city")).toHaveValue("Paris");
  await expect(page.locator("#kid_0_first")).toHaveValue("Byron");
  await expect(
    page.getByRole("region", { name: "History" }).locator("li").first(),
  ).toContainText('"city": "Paris"');
});

test("Escape discards the edit", async () => {
  await openDashboard();
  await bodyRow("Bea Brown").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  await table().getByRole("textbox", { name: "City" }).focus();
  await page.keyboard.type(" Changed");
  await page.keyboard.press("Escape");

  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(bodyRow("Bea Brown")).toBeFocused();
  await expect(table()).not.toContainText("Changed");
});

test("an invalid edit shows the error and stays in edit mode", async () => {
  await openDashboard();
  await bodyRow("Bea Brown")
    .getByRole("button", { name: "Edit Bea Brown" })
    .click();
  const email = table().getByRole("textbox", { name: "Email" });
  await email.fill("ada@example.test");
  await email.press("Enter");

  await expect(
    page.getByRole("alert").filter({ hasText: "You already have" }),
  ).toHaveText("You already have a contact with this email");
  await expect(email).toHaveValue("ada@example.test");
  await table().getByRole("button", { name: /Bea Brown/ }).click();
  const panel = page.getByRole("dialog", { name: "Household" });
  const first = panel.getByRole("textbox", { name: "Contact first name" });
  await first.fill("");
  await first.press("Enter");
  await expect(panel.getByText("Add a first name.")).toBeVisible();

  // The first Esc closes the panel, the second cancels the row.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(bodyRow("Bea Brown")).toContainText("bea@example.test");
});

test("Enter on the Cancel button discards the edit", async () => {
  await openDashboard();
  await bodyRow("Ada Lovelace").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  await table().getByRole("textbox", { name: "City" }).fill("Changed");
  await table().getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Enter");

  await expect(table().getByRole("textbox")).toHaveCount(0);
  await page.reload();
  await expect(bodyRow("Ada Lovelace")).toContainText("Paris");
});

test("Status sorts problems first and Updated sorts newest first", async () => {
  await openDashboard();
  const status = table().getByRole("columnheader", { name: "Status" });
  await status.getByRole("button").click();
  await expect(status).toHaveAttribute("aria-sort", "ascending");
  await expect(table().locator("tbody tr").last()).toContainText("Bea Brown");

  const updated = table().getByRole("columnheader", { name: "Updated" });
  await updated.getByRole("button").click();
  await expect(updated).toHaveAttribute("aria-sort", "descending");
  await expect(table().locator("tbody tr").first()).toContainText(
    "Ada Lovelace",
  );
});

test("a row save keeps changes made elsewhere since the page loaded", async () => {
  await openDashboard();
  await setContactCity(beaId, "Oslo");

  await bodyRow("Bea Brown")
    .getByRole("button", { name: "Edit Bea Brown" })
    .click();
  await table().getByRole("button", { name: /Bea Brown/ }).click();
  const panel = page.getByRole("dialog", { name: "Household" });
  await panel.getByRole("button", { name: "Add a child" }).click();
  await panel.getByRole("textbox", { name: "Child 1 first name" }).fill("Sam");
  await page.keyboard.press("Enter");
  // The open panel hides the row from role queries, so wait for it to close.
  await expect(panel).toHaveCount(0);
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(bodyRow("Bea Brown")).toContainText("· 1 kid");

  await page.goto(`/dashboard/contacts/${beaId}`);
  await expect(page.locator("#kid_0_first")).toHaveValue("Sam");
  await expect(page.locator("#city")).toHaveValue("Oslo");
});

test("a saved row shows the new value as soon as it leaves edit mode", async () => {
  await openDashboard();
  await bodyRow("Ada Lovelace").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  await table().getByRole("textbox", { name: "City" }).fill("Lisbon");
  await page.evaluate(() => {
    const w = window as { rowOnExit?: string };
    const tbody = document.querySelector('table[aria-label="Contacts"] tbody')!;
    const observer = new MutationObserver(() => {
      const row = [...tbody.querySelectorAll("tr")].find((tr) =>
        tr.textContent?.includes("Ada Lovelace"),
      );
      if (row && !row.querySelector("input[data-cell-input]")) {
        w.rowOnExit = row.textContent ?? "";
        observer.disconnect();
      }
    });
    observer.observe(tbody, { childList: true, subtree: true });
  });
  await page.keyboard.press("Enter");

  await expect(table().getByRole("textbox")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as { rowOnExit?: string }).rowOnExit),
  ).toContain("Lisbon");
});

test("shows the street and labels never-sent contacts", async () => {
  await openDashboard();
  await expect(bodyRow("Ada Lovelace")).toContainText("12 St James's Square");
  await expect(
    bodyRow("Cole Abernathy").getByText("Not sent", { exact: true }),
  ).toBeVisible();
});

test("O opens the focused contact, and Ctrl+O does not", async () => {
  await openDashboard();
  await bodyRow("Ada Lovelace").locator("td").nth(3).click();
  await page.keyboard.press("Control+o");
  const navigated = await page
    .waitForURL(/\/dashboard\/contacts\//, { timeout: 3_000 })
    .then(
      () => true,
      () => false,
    );
  expect(navigated).toBe(false);
  await page.keyboard.press("o");
  await expect(page).toHaveURL(new RegExp(`/dashboard/contacts/${adaId}$`));
});

test("arrow keys still move rows from a focused checkbox", async () => {
  await openDashboard();
  await table().getByLabel("Select Ada Lovelace").focus();
  await page.keyboard.press("ArrowDown");
  await expect(bodyRow("Bea Brown")).toBeFocused();
});

test("double-clicking a row edits it", async () => {
  await openDashboard();
  await bodyRow("Bea Brown").locator("td").nth(3).dblclick();
  await expect(table().getByRole("button", { name: /Bea/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(table().getByRole("textbox")).toHaveCount(0);
});

test("a save that only adds whitespace does not touch the row", async () => {
  const before = await getContactRow(adaId);
  await openDashboard();
  await bodyRow("Ada Lovelace").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  const city = table().getByRole("textbox", { name: "City" });
  await city.fill(`${before.city} `);
  await city.press("Enter");
  await expect(table().getByRole("textbox")).toHaveCount(0);

  const after = await getContactRow(adaId);
  expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
});

test("a saved row moves to the top of the Updated sort without a reload", async () => {
  await openDashboard();
  await bodyRow("Bea Brown").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  const city = table().getByRole("textbox", { name: "City" });
  await city.fill("Dallas");
  await city.press("Enter");
  await expect(table().getByRole("textbox")).toHaveCount(0);

  const updated = table().getByRole("columnheader", { name: "Updated" });
  await updated.getByRole("button").click();
  await expect(updated).toHaveAttribute("aria-sort", "descending");
  await expect(table().locator("tbody tr").first()).toContainText(
    "Bea Brown",
  );
});

test("a slow save does not pull focus out of the search box", async () => {
  await openDashboard();
  let held: Route | undefined;
  await page.route("**/dashboard", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    held = route;
  });
  await bodyRow("Bea Brown").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  const city = table().getByRole("textbox", { name: "City" });
  await city.fill("Hamar");
  await city.press("Enter");
  await expect(table().getByRole("button", { name: "Saving…" })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search contacts" });
  await search.click();
  await held!.continue();
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(bodyRow("Bea Brown")).toContainText("Hamar");
  await expect(search).toBeFocused();
  await page.unrouteAll({ behavior: "wait" });
});

test("saves and sends wait for each other", async () => {
  await openDashboard();
  let held: Route | undefined;
  await page.route("**/dashboard", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    held = route;
  });
  await bodyRow("Bea Brown").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  const city = table().getByRole("textbox", { name: "City" });
  await city.fill("Bodø");
  await city.press("Enter");
  await expect(
    page.getByRole("button", { name: "Send to all shown" }),
  ).toBeDisabled();
  await held!.continue();
  await expect(table().getByRole("textbox")).toHaveCount(0);

  held = undefined;
  await page.getByRole("button", { name: "Send to all shown" }).click();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.getByText("Sending…")).toBeVisible();
  await bodyRow("Ada Lovelace").locator("td").nth(3).dblclick();
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: "Still sending address requests" }),
  ).toBeVisible();
  await held!.abort();
  await page.unrouteAll({ behavior: "wait" });
});

test("an open row does not save while a send runs", async () => {
  await openDashboard();
  let held: Route | undefined;
  let posts = 0;
  await page.route("**/dashboard", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    held = route;
  });
  await bodyRow("Bea Brown").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  const city = table().getByRole("textbox", { name: "City" });
  await city.fill("Tromsø");

  await page.getByRole("button", { name: "Send to all shown" }).click();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.getByText("Sending…")).toBeVisible();
  await city.press("Enter");
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "Still sending address requests" });
  await expect(notice).toBeVisible();
  await expect(table().getByRole("button", { name: "Save" })).toBeVisible();

  await held!.abort();
  await expect(notice).toHaveCount(0);
  await expect(city).toHaveValue("Tromsø");
  expect(posts).toBe(1);
  await page.unrouteAll({ behavior: "wait" });
  await city.press("Enter");
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(bodyRow("Bea Brown")).toContainText("Tromsø");
});

test("a save refused during a send replaces the row's old error", async () => {
  await openDashboard();
  let held: Route | undefined;
  await bodyRow("Bea Brown").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  const email = table().getByRole("textbox", { name: "Email" });
  await email.fill("ada@example.test");
  await email.press("Enter");
  const alert = page.getByRole("alert").filter({ hasText: /\S/ });
  await expect(alert).toHaveText("You already have a contact with this email");

  await page.route("**/dashboard", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    held = route;
  });
  await page.getByRole("button", { name: "Send to all shown" }).click();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.getByText("Sending…")).toBeVisible();
  await email.fill("bea@example.test");
  await email.press("Enter");
  await expect(alert).toHaveText(
    "Still sending address requests. Try again when they finish.",
  );
  await held!.abort();
  await page.unrouteAll({ behavior: "wait" });
  await page.keyboard.press("Escape");
  await expect(table().getByRole("textbox")).toHaveCount(0);
});

test("a row deleted while being edited does not block other edits", async () => {
  const tempId = await seedContact({ bookId, fullName: "Temp Row" });
  await openDashboard();
  await bodyRow("Temp Row").locator("td").nth(3).dblclick();
  await expect(table().getByRole("button", { name: /Temp Row/ })).toBeVisible();

  await deleteContact(tempId);
  await page.evaluate(() =>
    (window as unknown as { next: { router: { refresh(): void } } }).next.router.refresh(),
  );
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await bodyRow("Ada Lovelace").locator("td").nth(3).dblclick();
  await expect(table().getByRole("button", { name: /Ada Lovelace/ })).toBeFocused();
  await page.keyboard.press("Escape");
});

test("pressing Enter twice while saving sends one save", async () => {
  await openDashboard();
  let posts = 0;
  await page.route("**/dashboard", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await bodyRow("Bea Brown").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  const city = table().getByRole("textbox", { name: "City" });
  await city.fill("Bergen");
  await city.press("Enter");
  await city.press("Enter");
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  expect(posts).toBe(1);
});

async function saveWithRewrittenArgs(
  rewrite: (args: [string, Record<string, unknown>]) => unknown[],
) {
  await openDashboard();
  await page.route("**/dashboard", (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const args = JSON.parse(request.postData() ?? "[]");
    return route.continue({ postData: JSON.stringify(rewrite(args)) });
  });
  await bodyRow("Bea Brown").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  const city = table().getByRole("textbox", { name: "City" });
  await city.fill("Tromsø");
  await city.press("Enter");
}

test("a save aimed at another owner's contact is refused", async () => {
  await saveWithRewrittenArgs(([, patch]) => [strangerContactId, patch]);
  await expect(
    page.getByRole("alert").filter({ hasText: "Contact not found." }),
  ).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
  expect((await getContactRow(strangerContactId)).city).toBe("Berlin");
  await page.keyboard.press("Escape");
});

test("a save with a field outside the sheet is refused", async () => {
  await saveWithRewrittenArgs(([id, patch]) => [
    id,
    { ...patch, book_id: "00000000-0000-0000-0000-000000000000" },
  ]);
  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid input" }),
  ).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
  expect((await getContactRow(beaId)).city).toBe("Bergen");
  await page.keyboard.press("Escape");
});

test("dragging a column edge resizes it, and the width survives a reload", async () => {
  await openDashboard();
  const city = table().getByRole("columnheader", { name: "City" });
  const before = (await city.boundingBox())!.width;
  const handle = (await city
    .getByRole("separator", { name: "Resize City" })
    .boundingBox())!;
  await page.mouse.move(handle.x + 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 82, handle.y + handle.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await city.boundingBox())!.width)
    .toBeGreaterThan(before + 60);
  await expect(city).not.toHaveAttribute("aria-sort");

  await page.reload();
  await expect
    .poll(async () => (await city.boundingBox())!.width)
    .toBeGreaterThan(before + 60);
});

test("phones see the list before scripts run", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const phone = await context.newPage();
    await phone.goto("/dashboard");
    await expect(
      phone.getByRole("list", { name: "Contacts" }).getByRole("listitem"),
    ).toHaveCount(3);
    await expect(phone.getByRole("table", { name: "Contacts" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("phones get a list with the same selection", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await openDashboard();
    const list = page.getByRole("list", { name: "Contacts" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(table()).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Columns" })).toHaveCount(0);

    await list.getByLabel("Select Bea Brown").check();
    await expect(
      page.getByRole("button", { name: "Request addresses (1)" }),
    ).toBeVisible();
    await expect(list.getByLabel("Select Cole Abernathy")).toBeDisabled();
  } finally {
    await page.setViewportSize({ width: 1280, height: 720 });
  }
});

test("hidden columns stay hidden after a reload", async () => {
  await openDashboard();
  await expect(
    table().getByRole("columnheader", { name: "Country" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Country" }).click();
  await page.keyboard.press("Escape");
  await expect(
    table().getByRole("columnheader", { name: "Country" }),
  ).toHaveCount(0);

  await page.reload();
  await expect(
    table().getByRole("columnheader", { name: "City" }),
  ).toBeVisible();
  await expect(
    table().getByRole("columnheader", { name: "Country" }),
  ).toHaveCount(0);
});

test("a selected contact whose email is cleared drops out of the request", async () => {
  await openDashboard();
  await table().getByLabel("Select Bea Brown").check();
  await expect(
    page.getByRole("button", { name: "Request addresses (1)" }),
  ).toBeVisible();
  await bodyRow("Bea Brown")
    .getByRole("button", { name: "Edit Bea Brown" })
    .click();
  const email = table().getByRole("textbox", { name: "Email" });
  await email.fill("");
  await email.press("Enter");
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Request addresses", exact: true }),
  ).toBeVisible();
});

test("the Name cell shows one line for the household", async () => {
  await seedContact({
    bookId,
    fullName: "x",
    email: "jen@example.test",
    household: {
      firstName: "Jen",
      lastName: "Holloway",
      partnerFirstName: "Mark",
      partnerLastName: "Holloway",
      kids: [{ first: "Zoe", last: "Holloway" }, { first: "Max" }],
    },
  });
  await seedContact({
    bookId,
    fullName: "x",
    email: "priya@example.test",
    household: {
      firstName: "Priya",
      lastName: "Raman",
      partnerFirstName: "Daniel",
      partnerLastName: "Okafor",
      kids: [{ first: "Asha", last: "Okafor" }],
    },
  });
  await seedContact({ bookId, fullName: "Cher", partnerName: "Sonny" });
  await openDashboard();

  await expect(
    table().getByRole("columnheader", { name: "Partner" }),
  ).toHaveCount(0);
  await expect(bodyRow("Jen & Mark Holloway")).toContainText("· 2 kids");
  await expect(bodyRow("Priya Raman & Daniel Okafor")).toContainText("· 1 kid");
  await expect(bodyRow("Cher & Sonny")).toContainText("(not split yet)");
  await expect(bodyRow("Jen & Mark Holloway")).not.toContainText("not split yet");
});

test("the household panel edits a kid by keyboard and Esc keeps the draft", async () => {
  await openDashboard();
  await bodyRow("Jen & Mark Holloway").locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  const name = table().getByRole("button", { name: /Jen & Mark Holloway/ });
  await expect(name).toBeFocused();

  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Household" });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("textbox", { name: "Contact first name" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    panel.getByRole("textbox", { name: "Contact last name" }),
  ).toBeFocused();
  await expect(
    panel.getByRole("textbox", { name: "Child 2 last name" }),
  ).toHaveValue("Holloway");
  await panel.getByRole("textbox", { name: "Child 2 first name" }).fill("Maxine");

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(name).toBeFocused();
  await expect(table().getByRole("button", { name: "Save" })).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(
    panel.getByRole("textbox", { name: "Child 2 first name" }),
  ).toHaveValue("Maxine");
  await panel.getByRole("textbox", { name: "Child 2 first name" }).press("Enter");
  await expect(panel).toHaveCount(0);
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(bodyRow("Jen & Mark Holloway")).toBeFocused();

  expect(await getContactNamesByEmail("jen@example.test")).toMatchObject({
    kidsNames: "Zoe, Maxine",
    kids: [
      { first: "Zoe", last: "Holloway" },
      { first: "Maxine", last: "Holloway" },
    ],
  });
});

test("Esc twice from the household panel cancels the row", async () => {
  await openDashboard();
  await bodyRow("Jen & Mark Holloway").locator("td").nth(3).dblclick();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Household" });
  await panel.getByRole("button", { name: "Remove partner" }).click();
  await page.keyboard.press("Escape");
  await expect(
    table().getByRole("button", { name: /^Jen Holloway/ }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(bodyRow("Jen & Mark Holloway")).toBeVisible();
});

test("splitting a legacy row waits for the required names", async () => {
  await openDashboard();
  await bodyRow("Cher & Sonny").locator("td").nth(3).dblclick();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Household" });
  await expect(panel).toContainText("Saved as one name: Cher · Sonny");
  await expect(
    panel.getByRole("textbox", { name: "Contact first name" }),
  ).toHaveValue("Cher");
  const last = panel.getByRole("textbox", { name: "Contact last name" });
  await expect(last).toHaveValue("");
  await last.press("Enter");
  await expect(panel.getByText("Add a last name.")).toBeVisible();
  await expect(last).toBeFocused();

  await last.fill("Sarkisian");
  await expect(panel.getByText("Add a last name.")).toHaveCount(0);
  await last.press("Enter");
  await expect(panel).toHaveCount(0);
  await expect(table().getByRole("textbox")).toHaveCount(0);
  const row = bodyRow("Cher & Sonny Sarkisian");
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("not split yet");
});

test("Sort by last name puts unsplit contacts last", async () => {
  await openDashboard();
  await page.getByRole("button", { name: "Sort" }).click();
  await page.getByRole("menuitemradio", { name: "Last name" }).click();
  await expect(page.getByRole("button", { name: "Sort: Last name" })).toBeVisible();
  await expect(table().locator("tbody tr")).toHaveText([
    /Bea Brown/,
    /Jen & Mark Holloway/,
    /Priya Raman & Daniel Okafor/,
    /Cher & Sonny Sarkisian/,
    /Ada Lovelace/,
    /Cole Abernathy/,
  ]);
});

test("a household edited elsewhere since the page loaded is not overwritten", async () => {
  await openDashboard();
  await bodyRow("Jen & Mark Holloway").locator("td").nth(3).dblclick();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Household" });
  await panel.getByRole("textbox", { name: "Partner last name" }).fill("Okafor");

  const updated = [
    { first: "Zoe", last: "Holloway" },
    { first: "Maxine", last: "Holloway" },
    { first: "Ivy", last: "Holloway" },
  ];
  await setContactKidsByEmail("jen@example.test", updated);
  await panel.getByRole("textbox", { name: "Partner last name" }).press("Enter");

  await expect(
    page.getByRole("alert").filter({ hasText: "names changed since you opened them" }),
  ).toBeVisible();
  expect(await getContactNamesByEmail("jen@example.test")).toMatchObject({
    partnerLastName: "Holloway",
    kidsNames: "Zoe, Maxine, Ivy",
  });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await table().getByRole("button", { name: "Cancel" }).click();
  await expect(table().getByRole("textbox")).toHaveCount(0);
});

test("removing the partner in the panel clears the partner on save", async () => {
  await openDashboard();
  await bodyRow("Priya Raman & Daniel Okafor").locator("td").nth(3).dblclick();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Household" });
  await panel.getByRole("button", { name: "Remove partner" }).click();
  await panel.getByRole("textbox", { name: "Contact first name" }).press("Enter");
  await expect(panel).toHaveCount(0);
  await expect(table().getByRole("textbox")).toHaveCount(0);

  await expect(bodyRow("Priya Raman")).not.toContainText("Daniel");
  expect(await getContactNamesByEmail("priya@example.test")).toMatchObject({
    partnerName: null,
    partnerFirstName: null,
    partnerLastName: null,
  });
});

let clockInstalled = false;

async function stallSave(name: string, value: string) {
  if (!clockInstalled) {
    await page.clock.install();
    clockInstalled = true;
  }
  await openDashboard();
  let held: Route | undefined;
  await page.route("**/dashboard", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    held = route;
  });
  await bodyRow(name).locator("td").nth(3).click();
  await page.keyboard.press("Enter");
  const city = table().getByRole("textbox", { name: "City" });
  await city.fill(value);
  await city.press("Enter");
  await expect(table().getByRole("button", { name: "Saving…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(city).toBeVisible();

  const stalled = page.getByRole("alert").filter({ hasText: "Still saving" });
  await page.clock.fastForward(13_000);
  await expect(stalled).toHaveCount(0);
  await page.clock.fastForward(2_000);
  await expect(stalled).toBeVisible();
  return {
    release: async (outcome: "continue" | "abort") => {
      await (outcome === "continue" ? held!.continue() : held!.abort());
    },
    done: () => page.unrouteAll({ behavior: "wait" }),
  };
}

test("a stalled save that finishes while still editing closes the row", async () => {
  const save = await stallSave("Ada Lovelace", "Rome");
  await save.release("continue");
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: "Still saving" }),
  ).toHaveCount(0);
  await expect(bodyRow("Ada Lovelace")).toContainText("Rome");
  await save.done();
});

test("a cancelled stalled save blocks other edits, then still lands", async () => {
  const save = await stallSave("Ada Lovelace", "Milan");
  await page.keyboard.press("Escape");
  await expect(table().getByRole("textbox")).toHaveCount(0);

  await bodyRow("Bea Brown").locator("td").nth(3).dblclick();
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: "Still saving your last change" }),
  ).toBeVisible();

  await save.release("continue");
  await expect(bodyRow("Ada Lovelace")).toContainText("Milan");
  await expect(
    page.getByRole("alert").filter({ hasText: "Still saving" }),
  ).toHaveCount(0);
  await save.done();
});

test("a cancelled stalled save that fails says so", async () => {
  const save = await stallSave("Ada Lovelace", "Turin");
  await page.keyboard.press("Escape");
  await save.release("abort");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Your change to Ada Lovelace wasn't saved." }),
  ).toBeVisible();
  await expect(table().getByRole("textbox")).toHaveCount(0);
  await expect(bodyRow("Ada Lovelace")).toContainText("Milan");

  await page.getByRole("button", { name: "Send to all shown" }).click();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.getByText("Sending…")).toBeVisible();
  await save.release("abort");
  await expect(page.getByText("Sending…")).toHaveCount(0);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Your change to Ada Lovelace wasn't saved." }),
  ).toBeVisible();
  await save.done();
});
