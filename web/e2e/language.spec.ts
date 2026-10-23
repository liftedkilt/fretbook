import { expect, test } from "./support/fixtures";

test("switch the language to Brazilian Portuguese", async ({ page, seed }) => {
  await seed.chordSheet();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const english = await page.getByTestId("library-count").innerText();

  await page.getByTestId("open-settings").click();
  await page.getByTestId("language-select").selectOption("pt-BR");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("library-count")).not.toHaveText(english);
  const portuguese = await page.getByTestId("library-count").innerText();

  // The choice is stored, so a reload keeps it.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.getByTestId("library-count")).toHaveText(portuguese);
  expect(await page.evaluate(() => localStorage.getItem("fretbook.locale"))).toBe("pt-BR");

  // And back to English.
  await page.getByTestId("open-settings").click();
  await page.getByTestId("language-select").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("library-count")).toHaveText(english);
});
