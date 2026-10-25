import type { Page } from "@playwright/test";

/** Opens the song page's "⋯" menu and clicks one of its items. */
export async function menuItem(page: Page, testid: string): Promise<void> {
  await page.getByTestId("song-more").click();
  await page.getByTestId(testid).click();
}

/** Opens the Export sheet from the "⋯" menu. */
export async function openExport(page: Page): Promise<void> {
  await menuItem(page, "export-open");
}

/** Types a tag into the inline "+ Tag" input and presses Enter. */
export async function addTag(page: Page, tag: string): Promise<void> {
  const input = page.getByTestId("song-tag-input");
  if (!(await input.isVisible())) await page.getByTestId("song-tag-new").click();
  await input.fill(tag);
  await input.press("Enter");
}
