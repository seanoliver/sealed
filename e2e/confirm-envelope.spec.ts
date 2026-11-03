import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  getContactNamesByEmail,
  clearRateLimits,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedEmailSend,
  seedOwnerBook,
  seedSpentExpiredToken,
  seedUpdateToken,
} from "./db";
import {
  signupAndLogin,
  stubTurnstile,
  uniqueEmail,
  uniqueSlug,
  waitForTurnstile,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("confirm-owner");
let ownerPage: Page;
let token: string;
let noAddressToken: string;
let fixToken: string;
let dropToken: string;
let coupleToken: string;
let guardToken: string;
let lostToken: string;
let familyToken: string;
let zipToken: string;
let line2Token: string;
let pruneToken: string;
let partnerToken: string;
let coupleNamesToken: string;
let soloPartnerToken: string;
let emailToken: string;
let expiredToken: string;
let staleToken: string;
let keepSelfToken: string;
let keepKidToken: string;
let followToken: string;
let ownLastToken: string;
let enterToken: string;
const familyOwnerEmail = uniqueEmail("confirm-family-owner");

test.beforeAll(async ({ browser }) => {
  await clearRateLimits();
  ownerPage = await browser.newPage();
  await signupAndLogin(ownerPage, ownerEmail);
  const bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("confirm-book"),
    displayName: "Confirm Owner",
    enabledFields: { partner_name: false, kids_names: false, birthday: false },
  });
  const contactId = await seedContact({
    bookId,
    fullName: "Cora Confirm",
    email: "cora@e2e.test",
    partnerName: "Hidden Partner",
    addressLine1: "1428 Alder St",
    city: "Portland",
    stateRegion: "OR",
    postalCode: "97214",
  });
  await seedEmailSend({
    contactId,
    bookId,
    resendId: `e2e_confirm_${Date.now().toString(36)}`,
  });
  token = await seedUpdateToken(contactId);
  fixToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Finn Fix",
      email: "finn@e2e.test",
      addressLine1: "9 Elm St",
    }),
  );
  dropToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Dee Drop",
      email: "dee@e2e.test",
      addressLine1: "3 Oak Ave",
    }),
  );
  const coupleId = await seedContact({
    bookId,
    fullName: "Cleo Couple",
    email: "cleo@e2e.test",
    partnerEmail: "cal@e2e.test",
    addressLine1: "5 Birch Rd",
    city: "Portland",
    stateRegion: "OR",
    postalCode: "97214",
  });
  for (const recipient of ["primary", "partner"] as const) {
    await seedEmailSend({
      contactId: coupleId,
      bookId,
      recipient,
      resendId: `e2e_confirm_${recipient}_${Date.now().toString(36)}`,
    });
  }
  coupleToken = await seedUpdateToken(coupleId);
  guardToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Gia Guard",
      email: "gia@e2e.test",
      addressLine1: "4 Pine Ct",
    }),
  );
  lostToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Lu Lost",
      email: "lu@e2e.test",
      addressLine1: "8 Fir Ln",
    }),
  );
  noAddressToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Satya & Family",
      email: "satya@e2e.test",
    }),
  );
  zipToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Zed Zip",
      email: "zed@e2e.test",
      addressLine1: "2217 Alder Street",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
    }),
  );
  const family = await seedOwnerBook({
    email: familyOwnerEmail,
    displayName: "Sean & Tina",
    slug: uniqueSlug("confirm-family"),
    enabledFields: { partner_name: true, kids_names: true, birthday: false },
  });
  familyToken = await seedUpdateToken(
    await seedContact({
      bookId: family.bookId,
      fullName: "Maya Chen",
      email: "maya@e2e.test",
      addressLine1: "2217 Alder Street",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
      household: { firstName: "Maya", lastName: "Chen" },
    }),
  );
  line2Token = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Lena Line",
      email: "lena@e2e.test",
      addressLine1: "7 Cove Rd",
      addressLine2: "Apt 4B",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
    }),
  );
  emailToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Ema Mail",
      email: "ema@e2e.test",
      addressLine1: "12 Wren Way",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
    }),
  );
  expiredToken = await seedSpentExpiredToken(
    await seedContact({ bookId, fullName: "Old Reply", addressLine1: "1 Past Ln" }),
  );
  staleToken = await seedUpdateToken(
    await seedContact({
      bookId,
      fullName: "Sam Stale",
      email: "sam@e2e.test",
      addressLine1: "3 Twin Ct",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
    }),
  );
  pruneToken = await seedUpdateToken(
    await seedContact({
      bookId: family.bookId,
      fullName: "Pia Prune",
      email: "pia@e2e.test",
      addressLine1: "40 Ash St",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
      household: { firstName: "Pia", lastName: "Prune" },
    }),
  );
  partnerToken = await seedUpdateToken(
    await seedContact({
      bookId: family.bookId,
      fullName: "Ana Park & Ben Park",
      email: "ana@e2e.test",
      partnerEmail: "ben@e2e.test",
      addressLine1: "9 Gate Rd",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
      household: { firstName: "Ana", lastName: "Park", partnerFirstName: "Ben", partnerLastName: "Park" },
    }),
    { recipient: "partner" },
  );
  coupleNamesToken = await seedUpdateToken(
    await seedContact({
      bookId: family.bookId,
      fullName: "Rae Rowe & Sol Rowe",
      email: "rae@e2e.test",
      partnerEmail: "sol@e2e.test",
      addressLine1: "11 Gate Rd",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
      household: { firstName: "Rae", lastName: "Rowe", partnerFirstName: "Sol", partnerLastName: "Rowe" },
    }),
  );
  keepSelfToken = await seedUpdateToken(
    await seedContact({
      bookId: family.bookId,
      fullName: "Ivy Keep & Jon Keep",
      email: "ivy@e2e.test",
      partnerEmail: "jon@e2e.test",
      addressLine1: "15 Gate Rd",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
      household: { firstName: "Ivy", lastName: "Keep", partnerFirstName: "Jon", partnerLastName: "Keep" },
    }),
    { recipient: "partner" },
  );
  keepKidToken = await seedUpdateToken(
    await seedContact({
      bookId: family.bookId,
      fullName: "Kay Kidd",
      email: "kay@e2e.test",
      addressLine1: "17 Gate Rd",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
      household: { firstName: "Kay", lastName: "Kidd", kids: [{ first: "Tom", last: "Kidd" }] },
    }),
  );
  followToken = await seedUpdateToken(
    await seedContact({
      bookId: family.bookId,
      fullName: "Ana Olivr",
      email: "ana.olivr@e2e.test",
      addressLine1: "19 Gate Rd",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
      household: {
        firstName: "Ana",
        lastName: "Olivr",
        partnerFirstName: "Ben",
        partnerLastName: "Olivr",
        kids: [{ first: "Kit" }],
      },
    }),
  );
  ownLastToken = await seedUpdateToken(
    await seedContact({
      bookId: family.bookId,
      fullName: "Ada Olivr & Cy Diaz",
      email: "ada.olivr@e2e.test",
      addressLine1: "21 Gate Rd",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
      household: { firstName: "Ada", lastName: "Olivr", partnerFirstName: "Cy", partnerLastName: "Diaz" },
    }),
  );
  enterToken = await seedUpdateToken(
    await seedContact({ bookId, fullName: "Eli Enter", email: "eli@e2e.test" }),
  );
  soloPartnerToken = await seedUpdateToken(
    await seedContact({
      bookId: family.bookId,
      fullName: "Nia Solo",
      email: "nia@e2e.test",
      partnerEmail: "oz@e2e.test",
      addressLine1: "13 Gate Rd",
      city: "Portland",
      stateRegion: "OR",
      postalCode: "97214",
      household: { firstName: "Nia", lastName: "Solo" },
    }),
    { recipient: "partner" },
  );
});

test.beforeEach(clearRateLimits);

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await cleanupUser(familyOwnerEmail);
  await ownerPage.close();
});

const saved = (page: Page) => page.getByRole("heading", { name: "Saved. Your card goes here." });

test("a recipient confirms the envelope in one tap", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await stubTurnstile(page);
  await page.goto(`/u/${token}/confirm`);

  await expect(
    page.getByRole("heading", { name: "Will your holiday card reach you here?" }),
  ).toBeVisible();
  await expect(page.getByText("From Confirm Owner")).toBeVisible();
  await expect(
    page.getByText("Only Confirm Owner sees what you enter. It isn't sold or shared."),
  ).toBeVisible();
  await expect(page.getByText("Tap any line to fix it")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sealed" })).toHaveAttribute("href", "/about");
  await expect(page.getByText("A small project by Sean Oliver")).toBeVisible();
  await expect(page.getByText("Why am I getting this?")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Use the full form instead" })).toHaveCount(0);
  const envelope = page.locator("address");
  await expect(envelope).toHaveText("Cora Confirm1428 Alder StPortland, OR 97214");
  expect(await page.content()).not.toContain("Hidden Partner");

  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Yes, send it here" }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.getByText("You confirmed this address. Nothing changed.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What changed" })).toHaveCount(0);
  await expect(page.getByText(/^Need to change something later\? This link keeps working until [A-Z][a-z]{2} \d{1,2}\.$/)).toBeVisible();

  await page.goto(`/u/${token}/confirm`);
  await expect(page.getByRole("button", { name: /^Cora Confirm\. Edit/ })).toBeVisible();
  await context.close();

  await ownerPage.goto("/dashboard");
  const row = ownerPage
    .getByRole("table", { name: "Contacts" })
    .locator("tbody tr", { hasText: "Cora Confirm" });
  await expect(row).toContainText("Confirmed"); // a reply that changed nothing
});

test("a couple's row shows one Confirmed chip, not a chip per person", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${coupleToken}/confirm`);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Yes, send it here" }).click();
  await expect(saved(page)).toBeVisible();

  await ownerPage.goto("/dashboard");
  const row = ownerPage
    .getByRole("table", { name: "Contacts" })
    .locator("tbody tr", { hasText: "Cleo Couple" });
  await expect(row).toContainText("Confirmed");
  await expect(row).not.toContainText("· Sent");
});

test("a dropped connection asks for another tap", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${dropToken}/confirm`);
  await waitForTurnstile(page);
  let dropped = false;
  await page.route(`**/u/${dropToken}/confirm`, (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      return route.abort("internetdisconnected");
    }
    return route.continue();
  });
  await page.getByRole("button", { name: /^Email:/ }).click();
  await page.locator("#email").fill("dee.new@e2e.test");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(page.getByText("The connection dropped. Tap again.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Email:/ })).toContainText("dee.new@e2e.test");
  await page.evaluate(() =>
    (window as unknown as { __ts: { solve: () => void } }).__ts.solve(),
  );
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.getByText("Email: dee.new@e2e.test")).toBeVisible();
});

test("a retry after a lost save response keeps the edits and saves", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${lostToken}/confirm`);
  await waitForTurnstile(page);
  let lost = false;
  await page.route(`**/u/${lostToken}/confirm`, async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch();
      return route.abort("internetdisconnected");
    }
    return route.continue();
  });
  await page.getByRole("button", { name: /^8 Fir Ln\. Edit/ }).click();
  await page.locator("#address_line1").fill("18 Fir Ln");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(page.getByText("The connection dropped. Tap again.")).toBeVisible();
  await expect(page.locator("address")).toContainText("18 Fir Ln");
  await page.evaluate(() =>
    (window as unknown as { __ts: { solve: () => void } }).__ts.solve(),
  );
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(saved(page)).toBeVisible();
});

test("the button waits for the bot check", async ({ page }) => {
  await stubTurnstile(page, { pending: true });
  await page.goto(`/u/${fixToken}/confirm`);
  await page.waitForFunction(() => "__ts" in window);
  await expect(
    page.getByRole("button", { name: "Checking you're human…" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (window as unknown as { __ts: { solve: () => void } }).__ts.solve(),
  );
  await expect(
    page.getByRole("button", { name: "Yes, send it here" }),
  ).toBeEnabled();
});

test("a failed bot check keeps the button disabled until a retry solves it", async ({ page }) => {
  await stubTurnstile(page, { failChallenge: true });
  await page.goto(`/u/${fixToken}/confirm`);
  await page.waitForFunction(() => "__ts" in window);
  await expect(
    page.getByRole("button", { name: "Yes, send it here" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "verification check didn’t load" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __ts: { solve: () => void } }).__ts.solve(),
  );
  await expect(
    page.getByRole("button", { name: "Yes, send it here" }),
  ).toBeEnabled();
});

test("edits survive moving between lines, and Escape closes a line", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${fixToken}/confirm`);
  await page.getByRole("button", { name: /^Finn Fix\. Edit/ }).click();
  await expect(page.locator("#first_name")).toBeFocused();
  await expect(page.getByText("First person")).toHaveCount(0);
  await page.locator("#last_name").fill("Fixer");
  await expect(page.locator("address")).toContainText("Finn Fixer");
  await page.getByRole("button", { name: /^9 Elm St\. Edit/ }).click();
  await expect(page.locator("#address_line1")).toBeVisible();
  await expect(page.locator("#last_name")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#address_line1")).toBeHidden();
  await expect(page.getByRole("button", { name: /^9 Elm St\. Edit/ })).toBeFocused();
  await page.getByRole("button", { name: /^Finn Fixer\. Edit/ }).click();
  await expect(page.locator("#last_name")).toHaveValue("Fixer");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("tapping a line edits it in place, a ZIP fills city and state, and sending saves", async ({
  page,
}) => {
  await stubTurnstile(page);
  await page.goto(`/u/${fixToken}/confirm`);
  await waitForTurnstile(page);
  await expect(
    page.getByRole("button", { name: "+ Add city, state and ZIP code" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes, send it here" })).toBeEnabled();

  await page.getByRole("button", { name: /^9 Elm St\. Edit/ }).click();
  const envelope = page.locator("address");
  await expect(envelope.locator("#address_line1")).toBeVisible();
  await expect(page.locator("#city")).toBeHidden();
  await envelope.locator("#address_line1").fill("11 Elm St");
  await envelope.getByRole("button", { name: "Done" }).click();
  await expect(envelope.locator("#address_line1")).toHaveCount(0);
  await expect(envelope).toContainText("11 Elm St");

  await page.getByRole("button", { name: "+ Add city, state and ZIP code" }).click();
  const zip = envelope.locator("#postal_code");
  const zipBox = await zip.boundingBox();
  const cityBox = await envelope.locator("#city").boundingBox();
  expect(zipBox!.y).toBeLessThan(cityBox!.y);
  await zip.fill("972");
  await envelope.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#postal_code-error")).toBeVisible();
  await zip.fill("97214");
  await expect(envelope.locator("#city")).toHaveValue("Portland");
  await expect(envelope.locator("#state_region")).toHaveValue("OR");
  await envelope.getByRole("button", { name: "Done" }).click();
  await expect(zip).toHaveCount(0);

  await page.getByRole("button", { name: "Send it here · 2 changes" }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.locator("address")).toHaveText("Finn Fix11 Elm StPortland, OR 97214");
  const changes = page.getByRole("region", { name: "What changed" });
  await expect(changes).toContainText("9 Elm St");
  await expect(changes).toContainText("11 Elm St, Portland, OR 97214");

  await ownerPage.goto("/dashboard");
  const row = ownerPage
    .getByRole("table", { name: "Contacts" })
    .locator("tbody tr", { hasText: "Finn Fix" });
  await expect(row).toContainText("11 Elm St");
});

test("a ZIP that disagrees with the city offers a fix or keeps theirs, and Edit again reopens it", async ({
  page,
}) => {
  await stubTurnstile(page);
  await page.goto(`/u/${zipToken}/confirm`);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: /^Portland, OR 97214\. Edit/ }).click();
  const envelope = page.locator("address");
  await envelope.locator("#postal_code").fill("94112");
  await expect(envelope.getByText("94112 is in San Francisco, CA")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Send it here/ })).toBeEnabled();
  await envelope.getByRole("button", { name: "Keep mine" }).click();
  await expect(envelope.getByText("94112 is in San Francisco, CA")).toHaveCount(0);
  await expect(envelope.locator("#city")).toHaveValue("Portland");

  await envelope.locator("#postal_code").fill("94110");
  await expect(envelope.getByText("94110 is in San Francisco, CA")).toBeVisible();
  await envelope.getByRole("button", { name: "Use San Francisco, CA" }).click();
  await expect(envelope.locator("#city")).toHaveValue("San Francisco");
  await expect(envelope.locator("#state_region")).toHaveValue("CA");
  await expect(envelope.getByText("is in San Francisco")).toHaveCount(0);
  await envelope.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(saved(page)).toBeVisible();
  const changes = page.getByRole("region", { name: "What changed" });
  await expect(changes).toContainText("2217 Alder Street, Portland, OR 97214");
  await expect(changes).toContainText("2217 Alder Street, San Francisco, CA 94110");
  await expect(page.locator("[data-changed]")).toHaveText(["San Francisco, CA 94110"]);

  await page.getByRole("button", { name: "Edit again" }).click();
  await expect(
    page.getByRole("button", { name: /^San Francisco, CA 94110\. Edit/ }),
  ).toBeVisible();
});

test("a recipient adds people on the envelope itself", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${familyToken}/confirm`);
  await waitForTurnstile(page);
  await expect(page.getByText("Only Sean & Tina see what you enter.")).toBeVisible();
  await page.getByRole("button", { name: /^Maya Chen\. Edit/ }).click();
  const names = page.getByRole("group", { name: "Names on the envelope" });
  await expect(names).toBeVisible();
  await expect(page.getByText("Names on the envelope")).toHaveCount(0);
  await expect(page.getByText("First person")).toHaveCount(0);

  await names.getByRole("button", { name: "Add a person" }).click();
  await names.getByLabel("Second person's first name").fill("Jordan");
  await names.getByLabel("Second person's last name").fill("Lee");
  await names.getByRole("button", { name: "Add", exact: true }).click();
  await expect(names.getByRole("button", { name: "Edit Jordan Lee" })).toBeVisible();
  await expect(names.getByRole("button", { name: "Remove Jordan Lee" })).toBeVisible();

  await names.getByRole("button", { name: "Add kids" }).click();
  await names.getByLabel("Child 1's first name").fill("Theo");
  await names.getByLabel("Child 1's last name").fill("Lee");
  await names.getByRole("button", { name: "Add", exact: true }).click();
  await expect(names.getByRole("button", { name: "Edit Theo Lee" })).toBeVisible();

  await names.getByRole("button", { name: "Add kids" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(names).toHaveCount(0);
  await expect(page.locator("address")).toContainText("Maya Chen & Jordan Lee");

  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(saved(page)).toBeVisible();
  const changes = page.getByRole("region", { name: "What changed" });
  await expect(changes.getByRole("listitem")).toHaveText(["Added Jordan Lee", "Added Theo Lee"]);
});

test("a bad postcode keeps earlier edits and sends the recipient back to it", async ({
  page,
}) => {
  await stubTurnstile(page);
  await page.goto(`/u/${guardToken}/confirm`);
  await waitForTurnstile(page);

  await page.getByRole("button", { name: /^Gia Guard\. Edit/ }).click();
  await page.locator("#last_name").fill("Guardian");
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "+ Add city, state and ZIP code" }).click();
  const envelope = page.locator("address");
  await envelope.locator("#city").fill("Portland");
  await envelope.locator("#state_region").selectOption("OR");
  await envelope.locator("#postal_code").fill("972");
  await envelope.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#postal_code-error")).toBeVisible();
  await expect(envelope).toContainText("Gia Guardian");
  await expect(envelope.locator("#postal_code")).toHaveValue("972");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Gia Guardian\. Edit/ }).click();
  await expect(page.locator("#last_name")).toHaveValue("Guardian");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^Send it here/ }).click();
  await expect(envelope.locator("#postal_code")).toBeFocused();

  await envelope.locator("#postal_code").fill("97214");
  await envelope.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /^Send it here/ }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.locator("address")).toContainText("Gia Guardian");
});

test("a contact with no address adds one line by line", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${noAddressToken}/confirm`);
  await waitForTurnstile(page);
  await expect(page).toHaveURL(new RegExp(`/u/${noAddressToken}/confirm$`));
  await expect(
    page.getByRole("button", { name: "Add your address to continue" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "+ Add street address" }).click();
  const envelope = page.locator("address");
  await envelope.locator("#address_line1").fill("1550 Larkin St");
  await envelope.getByRole("button", { name: "Next" }).click();
  await expect(envelope.locator("#postal_code")).toBeFocused();
  await envelope.locator("#postal_code").fill("94109");
  await expect(envelope.locator("#city")).toHaveValue("San Francisco");
  await expect(envelope.locator("#state_region")).toHaveValue("CA");
  await envelope.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: /^Send it here/ }).click();
  const names = page.getByRole("group", { name: "Names on the envelope" });
  await expect(names).toBeVisible();
  await expect(page.locator("#last_name")).toBeFocused();
  await names.locator("#last_name").fill("Rao");
  await page.getByRole("button", { name: "Done" }).click();
  await page.evaluate(() =>
    (window as unknown as { __ts: { solve: () => void } }).__ts.solve(),
  );
  await page.getByRole("button", { name: /^Send it here/ }).click();
  await expect(saved(page)).toBeVisible();
});

test("clearing the street while line 2 is set keeps the editor open and saves the retyped street", async ({
  page,
}) => {
  await stubTurnstile(page);
  await page.goto(`/u/${line2Token}/confirm`);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: /^7 Cove Rd, Apt 4B\. Edit/ }).click();
  const envelope = page.locator("address");
  await envelope.locator("#address_line1").fill("");
  await expect(envelope.locator("#address_line1")).toBeVisible();
  await expect(envelope.getByRole("button", { name: "Done" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "+ Add street address" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add your address to continue" })).toBeDisabled();

  await page.getByRole("button", { name: "+ Add street address" }).click();
  await envelope.locator("#address_line1").fill("70 Cove Rd");
  await expect(envelope.locator("#address_line1")).toBeFocused();
  await envelope.getByRole("button", { name: "Done" }).click();
  await expect(envelope).toContainText("70 Cove Rd, Apt 4B");
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.locator("address")).toContainText("70 Cove Rd, Apt 4B");
});

test("an abandoned + Add posts no blank person and counts no change", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${pruneToken}/confirm`);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: /^Pia Prune\. Edit/ }).click();
  const names = page.getByRole("group", { name: "Names on the envelope" });
  await names.getByRole("button", { name: "Add kids" }).click();
  await expect(names.getByLabel("Child 1's first name")).toBeVisible();
  await page.getByRole("button", { name: /^40 Ash St\. Edit/ }).click();
  await expect(names).toHaveCount(0);
  await page.getByRole("button", { name: "Yes, send it here" }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.getByText("You confirmed this address. Nothing changed.")).toBeVisible();
});

test("a partner who clears their own first name gets the names error, not removed", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${keepSelfToken}/confirm`);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: /^Ivy .*Keep\. Edit/ }).click();
  const names = page.getByRole("group", { name: "Names on the envelope" });
  await names.getByRole("button", { name: "Edit Jon Keep" }).click();
  await names.getByLabel("Your first name").fill("");
  await page.locator("button[type=submit]").click();
  await expect(names.getByLabel("Your first name")).toHaveAttribute("aria-invalid", "true");
  await expect(names.getByText("Add a first name, or remove this row.")).toBeVisible();
  await expect(saved(page)).toHaveCount(0);
  const stored = await getContactNamesByEmail("ivy@e2e.test");
  expect([stored.partnerFirstName, stored.partnerLastName]).toEqual(["Jon", "Keep"]);
});

test("clearing a saved kid's first name shows the names error instead of removing them", async ({
  page,
}) => {
  await stubTurnstile(page);
  await page.goto(`/u/${keepKidToken}/confirm`);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: /^Kay Kidd.*\. Edit/ }).click();
  const names = page.getByRole("group", { name: "Names on the envelope" });
  await names.getByRole("button", { name: "Edit Tom Kidd" }).click();
  await names.getByLabel("Child 1's first name").fill("");
  await page.getByRole("button", { name: "Done" }).click();
  await page.locator("button[type=submit]").click();
  await expect(names.getByLabel("Child 1's first name")).toHaveAttribute("aria-invalid", "true");
  await expect(names.getByText("Add a first name, or remove this row.")).toBeVisible();
  expect((await getContactNamesByEmail("kay@e2e.test")).kids).toEqual([{ first: "Tom", last: "Kidd" }]);
});

test("fixing the household last name carries to people who share it", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${followToken}/confirm`);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: /^Ana .*Olivr.*\. Edit/ }).click();
  const names = page.getByRole("group", { name: "Names on the envelope" });
  await names.getByRole("button", { name: "Edit Ana Olivr" }).click();
  await names.locator("#last_name").fill("Oliver");
  await expect(names.getByRole("button", { name: "Edit Ben Oliver" })).toBeVisible();
  await expect(names.getByRole("button", { name: "Edit Kit Oliver" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /^Send it here/ }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "What changed" }).getByRole("listitem")).toHaveText([
    "Ana Olivr → Ana Oliver",
    "Ben Olivr → Ben Oliver",
    "Kit Olivr → Kit Oliver",
  ]);
  const stored = await getContactNamesByEmail("ana.olivr@e2e.test");
  expect([stored.lastName, stored.partnerLastName]).toEqual(["Oliver", "Oliver"]);
  expect(stored.kids).toEqual([{ first: "Kit", last: "Oliver" }]);

  await page.goto(`/u/${ownLastToken}/confirm`);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: /^Ada .*Diaz\. Edit/ }).click();
  await names.getByRole("button", { name: "Edit Ada Olivr" }).click();
  await names.locator("#last_name").fill("Oliver");
  await expect(names.getByRole("button", { name: "Edit Cy Diaz" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /^Send it here/ }).click();
  await expect(saved(page)).toBeVisible();
  const own = await getContactNamesByEmail("ada.olivr@e2e.test");
  expect([own.lastName, own.partnerLastName]).toEqual(["Oliver", "Diaz"]);
});

test("Enter in an open address line or the email moves on instead of sending", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${enterToken}/confirm`);
  await waitForTurnstile(page);
  const envelope = page.locator("address");
  await page.getByRole("button", { name: "+ Add street address" }).click();
  await expect(envelope.locator("#address_line1")).toBeFocused();
  await expect(envelope.locator("#address_line1")).toHaveAttribute("enterkeyhint", "next");
  await envelope.locator("#address_line1").fill("1550 Larkin St");
  await envelope.locator("#address_line1").press("Enter");
  await expect(envelope.locator("#postal_code")).toBeFocused();
  await expect(saved(page)).toHaveCount(0);
  await expect(envelope.locator("#postal_code")).toHaveAttribute("enterkeyhint", "done");
  await envelope.locator("#postal_code").fill("94109");
  await expect(envelope.locator("#city")).toHaveValue("San Francisco");
  await envelope.locator("#postal_code").press("Enter");
  await expect(envelope.locator("#postal_code")).toBeHidden();
  await expect(saved(page)).toHaveCount(0);

  await page.getByRole("button", { name: /^Email:/ }).click();
  await page.locator("#email").fill("eli.new@e2e.test");
  await page.locator("#email").press("Enter");
  await expect(page.locator("#email")).toHaveCount(0);
  await expect(saved(page)).toHaveCount(0);

  await page.getByRole("button", { name: /^Send it here/ }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.locator("address")).toContainText("1550 Larkin St");
});

test("a partner's link labels the partner as the one replying", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${partnerToken}/confirm`);
  await page.getByRole("button", { name: /^Ana .*Park\. Edit/ }).click();
  const names = page.getByRole("group", { name: "Names on the envelope" });
  await names.getByRole("button", { name: "Edit Ben Park" }).click();
  await expect(names.getByLabel("Your first name")).toHaveValue("Ben");
  await expect(names.getByLabel("Your first name")).toHaveAttribute("autocomplete", "given-name");
  await expect(names.getByText("Second person's first name")).toHaveCount(0);

  await names.getByRole("button", { name: "Edit Ana Park" }).click();
  await expect(names.getByLabel("First person's first name")).toHaveValue("Ana");
  await expect(names.getByLabel("First person's first name")).toHaveAttribute("autocomplete", "off");
  await expect(names.getByText("Your first name")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^Ana .*Park\. Edit/ }).click();
  await expect(names.getByRole("button", { name: "Edit Ana Park" })).toBeVisible();
  await expect(names.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
});

test("on the primary's link only the partner's chip can be removed", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${coupleNamesToken}/confirm`);
  await page.getByRole("button", { name: /^Rae .*Rowe\. Edit/ }).click();
  const names = page.getByRole("group", { name: "Names on the envelope" });
  await expect(names.getByRole("button", { name: "Edit Rae Rowe" })).toBeVisible();
  await expect(names.getByRole("button", { name: "Remove Rae Rowe" })).toHaveCount(0);
  await expect(names.getByRole("button", { name: "Remove Sol Rowe" })).toBeVisible();
});

test("a partner's link labels the first person when only they are on the envelope", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${soloPartnerToken}/confirm`);
  await page.getByRole("button", { name: /^Nia Solo\. Edit/ }).click();
  const names = page.getByRole("group", { name: "Names on the envelope" });
  await expect(names.getByLabel("First person's first name")).toHaveValue("Nia");
  await expect(names.getByLabel("First person's last name")).toHaveValue("Solo");
  await expect(names.getByLabel("First name", { exact: true })).toHaveCount(0);
});

test("a recipient who changes their email can Edit again with the same link", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`/u/${emailToken}/confirm`);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: /^Email:/ }).click();
  await page.locator("#email").fill("ema.new@e2e.test");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.getByText("Email: ema.new@e2e.test")).toBeVisible();

  await page.getByRole("button", { name: "Edit again" }).click();
  await expect(page.getByRole("button", { name: /^Email:/ })).toContainText("ema.new@e2e.test");
  await expect(page.getByRole("button", { name: /^12 Wren Way\. Edit/ })).toBeVisible();
});

test("a used link past its expiry says so on /confirm", async ({ page }) => {
  await page.goto(`/u/${expiredToken}/confirm`);
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  await expect(page.getByText("Your reply is saved.")).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /send it here/i })).toHaveCount(0);
});

test("a save from a second open page is refused as stale", async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  for (const page of [first, second]) {
    await stubTurnstile(page);
    await page.goto(`/u/${staleToken}/confirm`);
    await waitForTurnstile(page);
  }

  await first.getByRole("button", { name: /^Email:/ }).click();
  await first.locator("#email").fill("sam.first@e2e.test");
  await first.getByRole("button", { name: "Done" }).click();
  await first.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(saved(first)).toBeVisible();

  await second.getByRole("button", { name: /^3 Twin Ct\. Edit/ }).click();
  await second.locator("address #address_line1").fill("33 Twin Ct");
  await second.locator("address").getByRole("button", { name: "Done" }).click();
  await second.getByRole("button", { name: "Send it here · 1 change" }).click();
  await expect(
    second.getByRole("alert").filter({
      hasText: "You changed this from another page since opening this one. Reload to see the latest.",
    }),
  ).toBeVisible();
  await expect(saved(second)).toHaveCount(0);
  await context.close();
});

test("unknown and malformed tokens get the generic page on /confirm", async ({
  page,
}) => {
  await page.goto("/u/not-a-real-token/confirm");
  await expect(
    page.getByRole("heading", { name: "Link not available" }),
  ).toBeVisible();
  await page.goto(`/u/${"A".repeat(43)}/confirm`);
  await expect(
    page.getByRole("heading", { name: "Link not available" }),
  ).toBeVisible();
});
