import { expect, test, type Page } from "@playwright/test";
import {
  cleanupUser,
  getContactReadings,
  getContactRow,
  getUserIdByEmail,
  seedBook,
  seedContact,
  seedPendingReply,
  seedPermalinkSubmission,
} from "./db";
import { signupAndLogin, uniqueEmail, uniqueSlug } from "./helpers";

test.describe.configure({ mode: "serial" });

const ownerEmail = uniqueEmail("pinyin-owner");

let page: Page;
let zengId: string;
let bookId: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  page = await browser.newPage();
  await signupAndLogin(page, ownerEmail);
  bookId = await seedBook({
    ownerId: await getUserIdByEmail(ownerEmail),
    slug: uniqueSlug("pinyin-book"),
  });
  await seedContact({
    bookId,
    fullName: "张伟",
    partnerName: "李娜",
    email: "wei@zhang.example",
    city: "Fremont",
  });
  zengId = await seedContact({
    bookId,
    fullName: "曾雨桐",
    email: "yutong@zeng.example",
    city: "Oakland",
  });
  await seedContact({ bookId, fullName: "Ada Lovelace", city: "London" });
  await page.request.get(`/dashboard/contacts/${zengId}`);
});

test.afterAll(async () => {
  await cleanupUser(ownerEmail);
  await page.close();
});

async function openDashboard(path = "/dashboard") {
  await page.goto(path);
  await page.waitForFunction(() => {
    const el = document.querySelector('table[aria-label="Contacts"]');
    return el !== null && Object.keys(el).some((k) => k.startsWith("__reactFiber"));
  });
}

const table = () => page.getByRole("table", { name: "Contacts" });
const bodyRow = (name: RegExp) => table().locator("tbody tr").filter({ hasText: name });

test("shows pinyin over each character in the sheet, surname first", async () => {
  await openDashboard();
  await expect(bodyRow(/张/).locator("rt")).toHaveText(["Zhāng", "Wěi", "Lǐ", "Nà"]);
  await expect(bodyRow(/曾/).locator("rt")).toHaveText(["Zēng", "Yǔ", "tóng"]);
  await expect(bodyRow(/Ada Lovelace/).locator("rt")).toHaveCount(0);
  await expect(bodyRow(/张/).getByRole("link")).toHaveAccessibleName("张伟 & 李娜");
});

test("the Columns menu hides pinyin and the choice sticks", async () => {
  await openDashboard();
  await page.getByRole("button", { name: "Columns" }).click();
  const toggle = page.getByRole("menuitemcheckbox", { name: "Show pinyin" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(table().locator("rt")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await openDashboard();
  await expect(bodyRow(/张/)).toBeVisible();
  await expect(table().locator("rt")).toHaveCount(0);

  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show pinyin" }).click();
  await page.keyboard.press("Escape");
  await expect(bodyRow(/张/).locator("rt")).toHaveCount(4);
});

test("searching pinyin finds names in Chinese characters", async () => {
  await openDashboard();
  await page.getByLabel("Search contacts").fill("zhang wei");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=zhang\+wei/);
  await expect(table().locator("tbody tr")).toHaveText([/张伟/]);

  await openDashboard("/dashboard?q=z%C4%93ng");
  await expect(table().locator("tbody tr")).toHaveText([/曾雨桐/]);
});

test("a row with pinyin still edits inline", async () => {
  await openDashboard();
  await bodyRow(/曾/).locator("td").nth(3).dblclick();
  const city = table().getByRole("textbox", { name: "City" });
  await city.fill("Berkeley");
  await city.press("Enter");
  await expect(table().getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(bodyRow(/曾/)).toContainText("Berkeley");
  await expect(bodyRow(/曾/).locator("rt")).toHaveCount(3);
  await expect.poll(async () => (await getContactRow(zengId)).city).toBe("Berkeley");
});

test("the owner corrects a reading on the contact page at phone width", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.goto(`/dashboard/contacts/${zengId}`);
    const reading = page.getByRole("textbox", { name: "Reading (pinyin)" });
    await expect(reading).toHaveValue("");
    await expect(page.getByText("Suggested: Zēng Yǔtóng.")).toBeVisible();

    await reading.fill("Céng Yǔtóng");
    await page.getByRole("button", { name: "Use suggestion" }).click();
    await expect(reading).toHaveValue("Zēng Yǔtóng");
    await reading.fill("Céng Yǔtóng");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    await expect
      .poll(() => getContactReadings(zengId))
      .toEqual({ nameReading: "Céng Yǔtóng", partnerNameReading: null });

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).locator("rt")).toHaveText([
      "Céng",
      "Yǔ",
      "tóng",
    ]);
    await page.goto("/dashboard");
    await expect(
      page.getByRole("list", { name: "Contacts" }).getByRole("listitem").filter({ hasText: /曾/ }).locator("rt"),
    ).toHaveText(["Céng", "Yǔ", "tóng"]);
  } finally {
    await page.setViewportSize({ width: 1280, height: 720 });
  }
});

test("replies in Chinese characters show pinyin in Two answers and on the review page", async () => {
  const liId = await seedContact({
    bookId,
    fullName: "华 李",
    email: "hua@li.example",
    partnerEmail: "na@li.example",
    household: { firstName: "华", lastName: "李", partnerFirstName: "娜", partnerLastName: "李" },
  });
  await seedPendingReply({
    bookId,
    contactId: liId,
    payload: {
      first_name: "华",
      last_name: "李",
      partner_first_name: "乐乐",
      partner_last_name: "王",
      city: "Oakland",
    },
    savedBy: "primary",
  });
  await seedPermalinkSubmission({
    bookId,
    payload: { first_name: "丹", last_name: "单", email: "dan@shan.example" },
  });

  await openDashboard();
  await bodyRow(/华/).getByRole("button", { name: "Two answers" }).click();
  const panel = page.getByRole("region", { name: /^Two answers for / });
  await expect(panel.locator("rt").filter({ hasText: /^Huá$/ }).first()).toBeVisible();
  await expect(panel.locator("rt").filter({ hasText: /^Lè$/ })).toHaveCount(1);
  await expect(panel.locator("rt").filter({ hasText: /^Wáng$/ })).toHaveCount(1);

  await page.goto("/dashboard/review");
  const merge = page.getByRole("listitem").filter({ hasText: "Possible update to existing contact" });
  await expect(merge.locator("rt").first()).toBeVisible();
  await expect(merge.locator("rt").filter({ hasText: /^Wáng$/ }).first()).toBeVisible();
  const fresh = page.getByRole("listitem").filter({ hasText: "New contact" });
  await expect(fresh.locator("rt")).toHaveText(["Dān", "Shàn"]);
});
