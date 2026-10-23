import { expect, test } from "./support/fixtures";

test("Settings shows the running version", async ({ page }) => {
  const meta = await (await page.request.get("/api/meta")).json();
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  const about = page.getByTestId("about-setting");
  await expect(about).toContainText(`Version ${meta.version}`);
  // A source checkout is not a CI image build, so there is no commit to show.
  await expect(about).not.toContainText("Build");
});
