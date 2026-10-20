import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  clearRateLimits,
  getContactAddress,
  getSenderCountry,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedUpdateToken,
} from "./db";
import { signupAndLogin, stubTurnstile, uniqueEmail, uniqueSlug } from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("addr-owner");
let ownerPage: Page;
let bookId: string;
let adaId: string;
let adaToken: string;
let wangId: string;
let wangTokens: string[];
let ukId: string;
let unknownId: string;
let beaId: string;
let blankId: string;
let beaToken: string;

const pickCountry = async (page: Page, code: string) => {
  const country = page.getByRole("combobox", { name: "Country", exact: true });
  await country.selectOption(code);
  await expect(country).toHaveValue(code);
};

test.beforeAll(async ({ browser }) => {
  await clearRateLimits();
  ownerPage = await browser.newPage();
  await signupAndLogin(ownerPage, ownerEmail);
  bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("addr-book"),
    displayName: "Sean",
    enabledFields: { partner_name: true, kids_names: false, birthday: false },
  });
  adaId = await seedContact({
    bookId,
    fullName: "Ada Lovelace",
    email: "ada@addr.test",
    household: { firstName: "Ada", lastName: "Lovelace" },
    addressLine1: "1427 Linden Avenue",
    addressLine2: "Apt 3B",
    city: "Portland",
    stateRegion: "Oregon",
    postalCode: "97214",
    country: "United States",
  });
  adaToken = await seedUpdateToken(adaId);
  wangId = await seedContact({
    bookId,
    fullName: "王芳",
    addressLine1: "上海市浦东新区张江路1500弄6号501室",
    country: "CHINA",
  });
  wangTokens = [await seedUpdateToken(wangId), await seedUpdateToken(wangId)];
  ukId = await seedContact({
    bookId,
    fullName: "Priya Raman",
    household: {
      firstName: "Priya",
      lastName: "Raman",
      partnerFirstName: "Daniel",
      partnerLastName: "Okafor",
    },
    addressLine1: "14 Kestrel Lane",
    addressLine2: "Flat 2",
    city: "Bristol",
    postalCode: "bs6 5qt",
    country: "UK",
  });
  beaId = await seedContact({
    bookId,
    fullName: "Bea Brown",
    household: { firstName: "Bea", lastName: "Brown" },
    addressLine1: "2 Pulteney Bridge",
    city: "Bath",
    stateRegion: "Somerset",
    postalCode: "BA2 4AT",
    countryCode: "GB",
  });
  beaToken = await seedUpdateToken(beaId);
  blankId = await seedContact({ bookId, fullName: "Cal Blank", addressLine1: "1 Main St", country: "Lemuria" });
  unknownId = await seedContact({
    bookId,
    fullName: "Nemo Diver",
    addressLine1: "1 Coral Way",
    country: "Atlantis",
  });
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await ownerPage.close();
});

test("the recipient form follows the country, checks the postcode and previews the envelope", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await stubTurnstile(page);
  await page.goto(`/u/${adaToken}`);

  const preview = page.getByRole("region", { name: "Envelope preview" });
  await expect(page.getByRole("combobox", { name: "Country", exact: true })).toHaveValue("US");
  await expect(page.getByLabel("State")).toHaveValue("OR");
  await expect(page.getByLabel("ZIP code")).toHaveValue("97214");
  await expect(preview).toContainText("Ada Lovelace");
  await expect(preview).toContainText("1427 Linden Avenue, Apt 3B");
  await expect(preview).toContainText("No country line: Sean mails from the US.");
  await expect(preview).not.toContainText("UNITED STATES");
  await expect(preview).toContainText("Portland, OR 97214");
  await expect(preview).not.toContainText("in capitals");
  await expect(preview.locator("[data-uppercased]")).toHaveCount(0);

  await page.locator("#first_name").fill("Augusta");
  await expect(preview).toContainText("Augusta Lovelace");

  await pickCountry(page, "GB");
  await expect(page.getByLabel("Post town")).toHaveValue("Portland");
  await expect(page.getByLabel("Postcode")).toHaveValue("97214");
  await expect(page.getByLabel("State")).toHaveCount(0);
  await expect(page.getByText("Flat, building")).toBeVisible();
  await page.getByLabel("Postcode").fill("bs6 5qt");
  await page.getByLabel("Post town").fill("Bristol");
  await expect(preview).toContainText("BRISTOL");
  await expect(preview).toContainText("BS6 5QT");
  await expect(preview).toContainText("UNITED KINGDOM");
  await expect(preview).toContainText("print in capitals, as Royal Mail asks.");

  await pickCountry(page, "US");
  await expect(page.getByLabel("State")).toHaveValue("OR");

  await pickCountry(page, "NL");
  await expect(page.getByLabel("Street and house number")).toHaveValue("1427 Linden Avenue");
  await page.getByLabel("Street and house number").fill("Keizersgracht 212");
  await page.getByLabel("City").fill("Amsterdam");
  await page.getByLabel("Postcode").fill("1016");
  await page.getByLabel("Postcode").blur();
  await expect(
    page.getByText("A Dutch postcode is four digits and two letters, like 1234 AB."),
  ).toBeVisible();
  await expect(preview).toContainText("1016 Amsterdam");

  await page.getByRole("button", { name: "Update my details" }).click();
  await expect(page).toHaveURL(new RegExp(`/u/${adaToken}$`));
  await expect(page.getByLabel("Postcode")).toBeFocused();

  await page.getByLabel("Postcode").fill("1016dz");
  await expect(page.getByText(/A Dutch postcode/)).toHaveCount(0);
  await page.getByRole("button", { name: "Update my details" }).click();
  await expect(page).toHaveURL(/\/u\/thanks$/);
  await context.close();

  expect(await getContactAddress(adaId)).toEqual({
    address_line1: "Keizersgracht 212",
    address_line2: "Apt 3B",
    district: null,
    city: "Amsterdam",
    state_region: null,
    postal_code: "1016 DZ",
    country_code: "NL",
    country: null,
  });
});

test("a China address in Chinese prints postcode first and name last, and saves as it was", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await stubTurnstile(page);
  await page.goto(`/u/${wangTokens[0]}`);

  await expect(page.getByRole("combobox", { name: "Country", exact: true })).toHaveValue("CN");
  await expect(page.getByLabel("Province")).toBeVisible();
  await expect(page.getByLabel("District")).toBeVisible();
  const preview = page.getByRole("region", { name: "Envelope preview" });
  await expect(preview.locator("address")).toHaveText(
    /上海市浦东新区张江路1500弄6号501室\s*王芳 收\s*CHINA/,
  );

  await page.getByLabel("Province").fill("上海市");
  await page.getByLabel("City").fill("上海市");
  await page.getByLabel("District").fill("浦东新区");
  await page.getByLabel("Street address").fill("张江路1500弄6号501室");
  await page.getByLabel("Postal code").fill("201203");
  await expect(preview.locator("address")).toHaveText(
    /^201203\s*上海市浦东新区\s*张江路1500弄6号501室\s*王芳 收\s*CHINA$/,
  );
  await expect(preview).toContainText("Chinese order: postcode first, name last.");
  await context.close();

  const again = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const unchanged = await again.newPage();
  await stubTurnstile(unchanged);
  await unchanged.goto(`/u/${wangTokens[1]}`);
  await unchanged.locator("#last_name").fill("Wang");
  await unchanged.getByRole("button", { name: "Update my details" }).click();
  await expect(unchanged).toHaveURL(/\/u\/thanks$/);
  await again.close();
  expect(await getContactAddress(wangId)).toMatchObject({
    address_line1: "上海市浦东新区张江路1500弄6号501室",
    city: null,
    postal_code: null,
    country_code: "CN",
  });
});

test("a stored value the country has no field for stays, and comes back after switching countries", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await stubTurnstile(page);
  await page.goto(`/u/${beaToken}`);
  await expect(page.getByLabel("County")).toHaveValue("Somerset");
  await expect(page.getByRole("region", { name: "Envelope preview" })).toContainText("Somerset");

  await pickCountry(page, "NG");
  await expect(page.getByLabel("County")).toHaveCount(0);
  await pickCountry(page, "GB");
  await expect(page.getByLabel("County")).toHaveValue("Somerset");

  await pickCountry(page, "CA");
  await expect(page.getByLabel("Province")).toHaveValue("Somerset");
  await page.getByLabel("Province").fill("Ontario");
  await pickCountry(page, "GB");
  await expect(page.getByLabel("County")).toHaveValue("Somerset");
  await pickCountry(page, "US");
  await expect(page.getByLabel("State")).toHaveValue("");
  await pickCountry(page, "GB");
  await expect(page.getByLabel("County")).toHaveValue("Somerset");
  await page.getByRole("button", { name: "Update my details" }).click();
  await expect(page).toHaveURL(/\/u\/thanks$/);
  await context.close();
  expect(await getContactAddress(beaId)).toMatchObject({ state_region: "Somerset", country_code: "GB" });
});

test("unrecognized country text stays when the owner saves without picking a country", async () => {
  await ownerPage.setViewportSize({ width: 1280, height: 900 });
  await ownerPage.goto(`/dashboard/contacts/${blankId}`);
  await expect(ownerPage.getByText("Saved as “Lemuria”, which isn't on the list.")).toBeVisible();
  const country = ownerPage.getByRole("combobox", { name: "Country", exact: true });
  await expect(country).toHaveValue("");
  await expect(country.locator("option").first()).toHaveText("Choose a country");
  await ownerPage.getByLabel("City").fill("Sunken City");
  await ownerPage.getByRole("button", { name: "Save changes" }).click();
  await expect(ownerPage.getByRole("status")).toHaveText("Saved.");
  expect(await getContactAddress(blankId)).toMatchObject({
    city: "Sunken City",
    country_code: null,
    country: "Lemuria",
  });
});

test("the owner's contact page edits the address with the envelope beside it", async () => {
  await ownerPage.setViewportSize({ width: 1280, height: 900 });
  await ownerPage.goto(`/dashboard/contacts/${ukId}`);
  const preview = ownerPage.getByRole("region", { name: "On the envelope" });
  await expect(ownerPage.getByRole("combobox", { name: "Country", exact: true })).toHaveValue("GB");
  await expect(preview).toContainText("Priya Raman & Daniel Okafor");
  await expect(preview).toContainText("Flat 2, 14 Kestrel Lane");
  await expect(preview).toContainText("UNITED KINGDOM");

  await ownerPage.getByLabel("Postcode").fill("BS6");
  await ownerPage.getByRole("button", { name: "Save changes" }).click();
  await expect(ownerPage.getByText("A UK postcode looks like EC1Y 8SY.")).toBeVisible();
  await ownerPage.getByLabel("Postcode").fill("bs65qt");
  await ownerPage.getByRole("button", { name: "Save changes" }).click();
  await expect(ownerPage.getByRole("status")).toHaveText("Saved.");
  expect(await getContactAddress(ukId)).toMatchObject({
    postal_code: "BS6 5QT",
    country_code: "GB",
  });

  await ownerPage.goto(`/dashboard/contacts/${unknownId}`);
  await expect(ownerPage.getByText("Saved as “Atlantis”, which isn't on the list.")).toBeVisible();
  await expect(ownerPage.getByRole("region", { name: "On the envelope" })).toContainText(
    "ATLANTIS",
  );
  await pickCountry(ownerPage, "GR");
  await ownerPage.getByRole("button", { name: "Save changes" }).click();
  await expect(ownerPage.getByRole("status")).toHaveText("Saved.");
  expect(await getContactAddress(unknownId)).toMatchObject({ country_code: "GR", country: null });
});

test("Settings sets the country the owner mails from", async () => {
  await ownerPage.goto("/dashboard/settings");
  const sender = ownerPage.getByRole("combobox", { name: "I mail from" });
  await expect(sender).toHaveValue("US");
  await expect(sender.locator("option[value='']")).toHaveCount(0);
  await sender.selectOption("GB");
  await ownerPage.getByRole("button", { name: "Save" }).click();
  await expect(ownerPage.getByRole("status")).toHaveText("Saved.");
  expect(await getSenderCountry(bookId)).toBe("GB");

  await ownerPage.goto(`/dashboard/contacts/${ukId}`);
  const preview = ownerPage.getByRole("region", { name: "On the envelope" });
  await expect(preview).toContainText("No country line: you mail from the UK.");
  await expect(preview).not.toContainText("UNITED KINGDOM");
});

test("the table's Country cell is a list of countries saved as codes", async () => {
  await ownerPage.setViewportSize({ width: 1280, height: 900 });
  await ownerPage.goto("/dashboard");
  const table = ownerPage.getByRole("table", { name: "Contacts" });
  const row = table.locator("tbody tr", { hasText: "Priya Raman" });
  await expect(row).toContainText("United Kingdom");
  await row.locator("td").nth(3).click();
  await ownerPage.keyboard.press("Enter");
  const country = table.getByRole("combobox", { name: "Country" });
  await country.selectOption("HK");
  await country.press("Enter");
  await expect(table.getByRole("combobox")).toHaveCount(0);
  await expect(row).toContainText("Hong Kong");
  expect(await getContactAddress(ukId)).toMatchObject({ country_code: "HK" });
});
