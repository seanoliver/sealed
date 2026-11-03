import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  clearRateLimits,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedEmailSend,
  seedOwnerBook,
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
  await expect(page.getByText("This link keeps working.")).toBeVisible();

  // Links are reusable until they expire: the envelope opens again.
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
  // One person: inputs straight away, and no "First person" label.
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
  // ZIP first: it sits above city and state.
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
  // Advisory: the button never blocks on it.
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

  // An abandoned add leaves nothing behind.
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
