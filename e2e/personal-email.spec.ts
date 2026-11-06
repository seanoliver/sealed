import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  clearRateLimits,
  getEmailColumns,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedUpdateToken,
  setContactEmailFields,
} from "./db";
import { signupAndLogin, stubTurnstile, uniqueEmail, uniqueSlug, waitForTurnstile } from "./helpers";

test.describe.configure({ mode: "serial" });

const SHOTS = process.env.E2E_SHOTS_DIR;
const ownerEmail = uniqueEmail("personal-owner");
const address = {
  addressLine1: "418 Alder Street",
  city: "Portland",
  stateRegion: "OR",
  postalCode: "97205",
  countryCode: "US",
};
let ownerPage: Page;
let bookId: string;

const seed = async (
  name: string,
  emails: { email: string; partnerEmail?: string },
  recipient: "primary" | "partner" = "primary",
) => {
  const [first, last] = name.split(" ");
  const contactId = await seedContact({
    bookId,
    fullName: name,
    ...emails,
    ...address,
    household: { firstName: first, lastName: last },
  });
  return { contactId, token: await seedUpdateToken(contactId, { recipient }) };
};

async function open(page: Page, token: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubTurnstile(page);
  await page.goto(`/u/${token}/confirm`);
  await waitForTurnstile(page);
}

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test.beforeAll(async ({ browser }) => {
  await clearRateLimits();
  ownerPage = await browser.newPage();
  await signupAndLogin(ownerPage, ownerEmail);
  bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("personal-book"),
    displayName: "Sean",
    enabledFields: { partner_name: true, kids_names: false, birthday: false },
  });
});

test.afterAll(async () => {
  await ownerPage.close();
  await cleanupUser(ownerEmail);
});

test("a recipient at a work address adds a personal email and keeps the link", async ({ page }) => {
  const { contactId, token } = await seed("Maya Chen", { email: "maya@northwindfreight.com" });
  await open(page, token);
  const field = page.getByLabel("Personal email (optional)");
  await expect(page.getByText("This looks like a work email.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes, send it here" })).toBeEnabled();
  await shot(page, "01-first-view");

  await field.fill("maya.chen@gmail");
  await expect(page.getByRole("button", { name: "Send it here · 1 change" })).toBeEnabled();
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(page.getByText("It needs to look like name@example.com")).toBeVisible();
  await shot(page, "03-error");
  expect((await getEmailColumns(contactId)).personal_email).toBeNull();

  await waitForTurnstile(page);
  await field.fill("maya.chen@gmail.com");
  await expect(page.getByText("Sean keeps maya@northwindfreight.com too.")).toBeVisible();
  await shot(page, "02-filled");
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(page.getByRole("heading", { name: "Saved. Your card goes here." })).toBeVisible();
  await expect(page.getByText("Personal email: maya.chen@gmail.com")).toBeVisible();
  await shot(page, "04-saved");

  expect(await getEmailColumns(contactId)).toMatchObject({
    email: "maya@northwindfreight.com",
    personal_email: "maya.chen@gmail.com",
  });

  await page.goto(`/u/${token}/confirm`);
  await expect(page.getByText("This looks like a work email.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Personal email: maya\.chen@gmail\.com/ })).toBeVisible();
  await shot(page, "05-reopened");
});

test("skipping the question is a plain confirm", async ({ page }) => {
  const { contactId, token } = await seed("Tess Vale", { email: "tess@acmeworks.co" });
  await open(page, token);
  await page.getByRole("button", { name: "Yes, send it here" }).click();
  await expect(page.getByText("You confirmed this address. Nothing changed.")).toBeVisible();
  expect((await getEmailColumns(contactId)).personal_email).toBeNull();
});

test("a personal address or an owner override means no question", async ({ page }) => {
  const consumer = await seed("Jo Whitfield", { email: "jo.whitfield@outlook.com" });
  await open(page, consumer.token);
  await expect(page.getByRole("button", { name: "Yes, send it here" })).toBeVisible();
  await expect(page.getByText("This looks like a work email.")).toHaveCount(0);

  const owned = await seed("Ren Sato", { email: "ren@rensato.studio" });
  await setContactEmailFields(owned.contactId, { email_kind: "personal" });
  await open(page, owned.token);
  await expect(page.getByRole("button", { name: "Yes, send it here" })).toBeVisible();
  await expect(page.getByText("This looks like a work email.")).toHaveCount(0);
});

test("a partner's answer lands on the partner", async ({ page }) => {
  const { contactId, token } = await seed(
    "Priya Rao",
    { email: "priya@gmail.com", partnerEmail: "tom@raodesign.co" },
    "partner",
  );
  await open(page, token);
  await page.getByLabel("Personal email (optional)").fill("tom.rao@gmail.com");
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(page.getByRole("heading", { name: "Saved. Your card goes here." })).toBeVisible();
  expect(await getEmailColumns(contactId)).toMatchObject({
    email: "priya@gmail.com",
    partner_email: "tom@raodesign.co",
    personal_email: null,
    partner_personal_email: "tom.rao@gmail.com",
  });
});

test("the owner overrides the check and adds a personal email", async () => {
  const { contactId } = await seed("Lena Ortiz", { email: "lena@lenaortiz.com" });
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await ownerPage.goto(`/dashboard/contacts/${contactId}`);
  const ask = ownerPage.getByRole("checkbox", { name: /Ask for a personal email/ }).first();
  await expect(ask).toBeChecked();
  await shot(ownerPage, "06-owner-detected");
  await ask.uncheck();
  await ownerPage.getByRole("button", { name: "Save changes" }).click();
  await expect(ownerPage.getByText("Saved.", { exact: true })).toBeVisible();
  await expect.poll(async () => (await getEmailColumns(contactId)).email_kind).toBe("personal");

  await ownerPage.goto(`/dashboard/contacts/${contactId}`);
  await expect(ownerPage.getByRole("checkbox", { name: /Ask for a personal email/ }).first()).not.toBeChecked();
  await ownerPage.getByLabel("Personal email", { exact: true }).fill("lena.ortiz@gmail.com");
  await expect(ownerPage.getByText("Invites go here")).toBeVisible();
  await ownerPage.getByRole("button", { name: "Save changes" }).click();
  await expect(ownerPage.getByText("Saved.", { exact: true })).toBeVisible();
  await shot(ownerPage, "07-owner-saved");
  expect(await getEmailColumns(contactId)).toMatchObject({
    email: "lena@lenaortiz.com",
    personal_email: "lena.ortiz@gmail.com",
  });

  await ownerPage.goto("/dashboard");
  await expect(ownerPage.getByText("lena.ortiz@gmail.com · was lena@lenaortiz.com")).toBeVisible();
  await shot(ownerPage, "08-owner-list");
});
