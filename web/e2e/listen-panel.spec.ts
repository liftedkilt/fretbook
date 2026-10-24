import { expect, test } from "./support/fixtures";

// Chromium's fake microphone feeds a beep, so the engine runs without hardware.
test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test.describe("Listen panel on the standalone tuner", () => {
  test("lists the input device and shows the level while listening", async ({ page }) => {
    await page.goto("/tools/tuner");
    const view = page.getByTestId("standalone-tuner-view");
    const panel = view.getByTestId("listen-panel");
    await expect(panel).toBeVisible();
    await expect(view.getByTestId("listen-meter")).toHaveAttribute("aria-valuenow", "0");

    // The fake microphone beeps briefly once a second, so a poll can land between beeps: keep the peak.
    await view.getByTestId("listen-meter").evaluate((meter) => {
      const w = window as unknown as { __meterPeak: number };
      w.__meterPeak = 0;
      new MutationObserver(() => {
        w.__meterPeak = Math.max(w.__meterPeak, Number(meter.getAttribute("aria-valuenow")));
      }).observe(meter, { attributes: true, attributeFilter: ["aria-valuenow"] });
    });

    await view.getByTestId("tuner-start").click();
    await expect(view.getByTestId("tuner-stop")).toBeVisible();
    await expect(view.getByTestId("listen-device").locator("option")).not.toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __meterPeak: number }).__meterPeak), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    await view.getByTestId("tuner-stop").click();
    await expect(view.getByTestId("listen-meter")).toHaveAttribute("aria-valuenow", "0");
  });
});
