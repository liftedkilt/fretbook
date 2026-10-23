import { expect, test } from "./support/fixtures";

test("Settings shows the running version", async ({ page }) => {
  const meta = await (await page.request.get("/api/meta")).json();
  expect(meta.version).toBeTruthy();
  expect(meta.ytdlp?.version).toBeTruthy();

  await page.goto("/");
  await page.getByTestId("open-settings").click();
  const about = page.getByTestId("about-setting");
  await expect(about).toContainText(`Version ${meta.version}`);
  // A source checkout is not a CI image build, so there is no commit to show.
  if (meta.commit) {
    await expect(about).toContainText(`Build ${meta.commit.slice(0, 7)}`);
  } else {
    await expect(about).not.toContainText("Build");
  }

  const ytdlp = page.getByTestId("ytdlp-setting");
  await expect(ytdlp).toContainText(`Version ${meta.ytdlp.version}`);
});
