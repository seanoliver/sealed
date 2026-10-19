import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedEmailSend,
} from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("status-owner");
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signupAndLogin(page, ownerEmail);
  const bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("status-book"),
    displayName: "Status Owner",
  });
  const seeded = async (
    fullName: string,
    email: string,
    send?: Omit<Parameters<typeof seedEmailSend>[0], "contactId" | "bookId">,
  ) => {
    const contactId = await seedContact({ bookId, fullName, email });
    if (send) await seedEmailSend({ contactId, bookId, ...send });
  };
  await seeded("Fay Rejected", "fay@e2e.test", {
    resendId: null,
    status: "failed",
    failureReason: "rejected",
  });
  await seeded("Quinn Quota", "quinn@e2e.test", {
    resendId: null,
    status: "failed",
    failureReason: "quota",
  });
  await seeded("Eli Error", "eli@e2e.test", {
    resendId: null,
    status: "failed",
    failureReason: "error",
  });
  await seeded("Uma Unsure", "uma@e2e.test", {
    resendId: null,
    status: "unconfirmed",
  });
  await seeded("Bo Bounce", "bo@e2e.test", {
    resendId: `re_bo_${Date.now()}`,
    status: "bounced",
  });
  await seeded("Sam Smith", "sam@e2e.test", {
    resendId: `re_sam_${Date.now()}`,
  });
  await seeded("Ivy Bad", "ivy@bad.invalid");
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await page.close();
});

const table = () => page.getByRole("table", { name: "Contacts" });
const row = (name: string) => table().locator("tbody tr", { hasText: name });

test("each failure reason and status shows on its row", async () => {
  await page.goto("/dashboard");
  await expect(row("Fay Rejected")).toContainText("Invalid email");
  await expect(row("Quinn Quota")).toContainText("Daily limit hit");
  await expect(row("Eli Error")).toContainText("Send failed");
  await expect(row("Uma Unsure")).toContainText("Unconfirmed");
  await expect(row("Bo Bounce")).toContainText("Bounced");
  await expect(row("Sam Smith")).toContainText("Sent");
});

test("the Needs attention filter shows only those rows", async () => {
  await page.goto("/dashboard");
  const filter = page.getByRole("button", { name: "Needs attention (5)" });
  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(table().locator("tbody tr")).toHaveCount(5);
  await expect(row("Sam Smith")).toHaveCount(0);
  await filter.click();
  await expect(table().locator("tbody tr")).toHaveCount(7);
});

test("the confirm dialog counts contacts whose link will be replaced", async () => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Send to all shown" }).click();
  await expect(
    page.getByRole("dialog", { name: "Confirm address request" }),
  ).toContainText(
    "2 already have a link, which gets replaced once the new email arrives.",
  );
});

test("a send with a failure reports it and the pill counts it", async () => {
  await page.goto("/dashboard");
  await row("Ivy Bad").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Request addresses (1)" }).click();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sent 0 of 1" }),
  ).toContainText("1 need attention");
  const filter = page.getByRole("button", { name: "Needs attention (6)" });
  await expect(filter).toHaveAttribute("aria-pressed", "false");
  await expect(row("Ivy Bad")).toContainText("Invalid email");
});

test("an open edit stays when the filter turns on", async () => {
  await page.goto("/dashboard");
  await row("Sam Smith").locator("td").nth(3).dblclick();
  await page.getByRole("button", { name: "Needs attention (6)" }).click();
  await expect(row("Sam Smith").getByRole("textbox").first()).toBeVisible();
  await expect(table().locator("tbody tr")).toHaveCount(7);
});

test("an open edit survives its row being fixed while filtered", async () => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Needs attention/ }).click();
  await row("Fay Rejected").locator("td").nth(3).dblclick();
  await row("Fay Rejected").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Request addresses (1)" }).click();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sent 1 of 1" }),
  ).toBeVisible();
  // Fay no longer needs attention once the refreshed rows land.
  await expect(
    page.getByRole("button", { name: "Needs attention (5)" }),
  ).toBeVisible();
  await expect(row("Fay Rejected").getByRole("textbox").first()).toBeVisible();
  await row("Fay Rejected").getByRole("textbox").first().press("Escape");
  await expect(row("Fay Rejected").getByRole("textbox")).toHaveCount(0);
  await expect(row("Fay Rejected")).toContainText("Sent");
});

test("sending to the filtered view skips rows fixed since the snapshot", async () => {
  await page.getByRole("button", { name: "Send to all shown" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm address request" });
  await expect(dialog).toContainText("the 5 shown that still need attention");
});
