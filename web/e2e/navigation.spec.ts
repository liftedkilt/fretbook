import { expect, test } from "./support/fixtures";

const DESTINATIONS = ["practice", "library", "setlists", "tools"];

test("the sidebar offers one New, the five destinations and no kind filters", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("add-song")).toHaveCount(1);
  await expect(page.getByTestId("add-song-hero")).toHaveCount(0);
  await expect(page.locator(".sidebar").getByText("Recently updated")).toHaveCount(0);
  await expect(page.getByTestId("nav-library")).toHaveAttribute("aria-current", "page");

  // Tab reaches every destination in order.
  await page.getByTestId("add-song").focus();
  for (const id of DESTINATIONS) {
    await page.keyboard.press("Tab");
    await expect(page.getByTestId(`nav-${id}`)).toBeFocused();
  }

  // Lessons is experimental and off by default.
  await expect(page.getByTestId("nav-lessons")).toHaveCount(0);
});

test("turning Lessons on adds it to the sidebar and tab bar without a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings");
  await expect(page.getByTestId("nav-lessons")).toHaveCount(0);
  await page.getByTestId("lessons-enabled").check();
  await expect(page.getByTestId("nav-lessons")).toBeVisible();
  await page.getByTestId("nav-lessons").click();
  await expect(page).toHaveURL(/\/lessons$/);
  await expect(page.getByTestId("course-card-guitar-first-steps")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("tab-lessons")).toBeVisible();
});

test("/lessons says Lessons is turned off and opens the setting", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lessons/guitar-first-steps");
  await expect(page.getByTestId("lessons-off")).toContainText("Lessons is turned off");
  await page.getByTestId("lessons-open-settings").click();
  await expect(page).toHaveURL(/\/settings#general$/);
  await expect(page.getByTestId("lessons-enabled")).toBeVisible();
});

test("the tablet rail names each item with a tooltip", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  const link = page.getByTestId("nav-setlists");
  await expect(link).toHaveAccessibleName("Setlists");
  await link.hover();
  const tip = await link.evaluate((el) => getComputedStyle(el, "::after").opacity);
  expect(tip).toBe("1");
});

test("the phone tab bar is Practice, Library, +, Setlists, Tools with the + centred", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const items = await page
    .locator(".tabbar > *")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-testid")));
  expect(items).toEqual(["tab-practice", "tab-library", "tab-add", "tab-setlists", "tab-tools"]);
  const add = await page.getByTestId("tab-add").boundingBox();
  expect(Math.abs(add!.x + add!.width / 2 - 375 / 2)).toBeLessThanOrEqual(1);

  // Setlists is reached from the Songs | Setlists switch.
  await page.getByTestId("library-switch-setlists").click();
  await expect(page).toHaveURL("/setlists");
  await expect(page.getByTestId("tab-setlists")).toHaveAttribute("aria-current", "page");
  await page.getByTestId("library-switch-songs").click();
  await expect(page).toHaveURL("/");
});
