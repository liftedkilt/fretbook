import { expect, test } from "./support/fixtures";

test.describe("Tools page: standalone tuner and metronome", () => {
  test("reaches tools page and each tool from the desktop nav", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-tools").click();
    await expect(page).toHaveURL("/tools");
    await expect(page.getByTestId("tools-view")).toBeVisible();

    // Open Tuner from card
    await page.getByTestId("tool-card-tuner").click();
    await expect(page).toHaveURL("/tools/tuner");
    const tunerView = page.getByTestId("standalone-tuner-view");
    await expect(tunerView).toBeVisible();
    await expect(tunerView.getByTestId("tuner-dial")).toBeVisible();

    // Back to tools
    await tunerView.getByTestId("tool-back").click();
    await expect(page).toHaveURL("/tools");

    // Open Metronome from card
    await page.getByTestId("tool-card-metronome").click();
    await expect(page).toHaveURL("/tools/metronome");
    const metronomeView = page.getByTestId("standalone-metronome-view");
    await expect(metronomeView).toBeVisible();
    await expect(metronomeView.getByTestId("metronome-visual")).toBeVisible();

    // Back to tools
    await metronomeView.getByTestId("tool-back").click();
    await expect(page).toHaveURL("/tools");
  });

  test("mobile navigation and 44px touch targets", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    // Reach tools from mobile bottom tabbar
    const tabTools = page.getByTestId("tab-tools");
    await expect(tabTools).toBeVisible();
    const tabBox = await tabTools.boundingBox();
    expect(tabBox!.height).toBeGreaterThanOrEqual(44);
    expect(tabBox!.width).toBeGreaterThanOrEqual(44);

    await tabTools.click();
    await expect(page).toHaveURL("/tools");

    // Open standalone tuner
    await page.getByTestId("tool-card-tuner").click();
    await expect(page).toHaveURL("/tools/tuner");

    const tunerView = page.getByTestId("standalone-tuner-view");

    // Check back button touch target
    const backBtn = tunerView.getByTestId("tool-back");
    const backBox = await backBtn.boundingBox();
    expect(backBox!.height).toBeGreaterThanOrEqual(44);

    // Check tuner instrument select touch target
    const instSelect = tunerView.getByTestId("tuner-instrument");
    const instBox = await instSelect.boundingBox();
    expect(instBox!.height).toBeGreaterThanOrEqual(44);

    // Check tuner string button touch target
    const stringBtn = tunerView.getByTestId("tuner-string-0");
    const stringBox = await stringBtn.boundingBox();
    expect(stringBox!.height).toBeGreaterThanOrEqual(44);

    // Check tuner action start button touch target
    const startBtn = tunerView.getByTestId("tuner-start");
    const startBox = await startBtn.boundingBox();
    expect(startBox!.height).toBeGreaterThanOrEqual(44);

    // Navigate to metronome
    await page.goto("/tools/metronome");
    const metronomeView = page.getByTestId("standalone-metronome-view");
    await expect(metronomeView).toBeVisible();

    // Check metronome buttons touch targets
    const toggleBtn = metronomeView.getByTestId("metronome-toggle");
    const toggleBox = await toggleBtn.boundingBox();
    expect(toggleBox!.height).toBeGreaterThanOrEqual(44);

    const tapBtn = metronomeView.getByTestId("metronome-tap");
    const tapBox = await tapBtn.boundingBox();
    expect(tapBox!.height).toBeGreaterThanOrEqual(44);

    const stepBtn = metronomeView.getByTestId("metronome-bpm-plus-1");
    const stepBox = await stepBtn.boundingBox();
    expect(stepBox!.height).toBeGreaterThanOrEqual(44);
  });

  test("standalone tuner picks instrument, tuning, and remembers choices", async ({ page }) => {
    await page.goto("/tools/tuner");
    const tunerView = page.getByTestId("standalone-tuner-view");
    await expect(tunerView).toBeVisible();

    // Default is 6-string guitar standard
    await expect(tunerView.getByTestId("tuner-instrument")).toHaveValue("guitar6");
    await expect(tunerView.getByTestId("tuner-string-5")).toContainText("E2");
    await expect(tunerView.getByTestId("tuner-string-0")).toContainText("E4");

    // Switch to Bass 4-string
    await tunerView.getByTestId("tuner-instrument").selectOption("bass4");
    await expect(tunerView.getByTestId("tuner-string-3")).toContainText("E1");
    await expect(tunerView.getByTestId("tuner-string-0")).toContainText("G2");
    await expect(tunerView.getByTestId("tuner-string-4")).toHaveCount(0);

    // Switch to Custom tuning
    await tunerView.getByTestId("tuner-tuning").selectOption("custom");
    const customInput = tunerView.getByTestId("tuner-custom-tuning");
    await expect(customInput).toBeVisible();
    await customInput.fill("D4 A3 F#3 D3 A2 D2");
    await expect(tunerView.getByTestId("tuner-string-5")).toContainText("D2");

    // Reload page and check choices were remembered
    await page.reload();
    const reloadedView = page.getByTestId("standalone-tuner-view");
    await expect(reloadedView.getByTestId("tuner-instrument")).toHaveValue("bass4");
    await expect(reloadedView.getByTestId("tuner-tuning")).toHaveValue("custom");
    await expect(reloadedView.getByTestId("tuner-string-5")).toContainText("D2");
  });

  test("standalone metronome adjusts tempo, time signature, and controls", async ({ page }) => {
    await page.goto("/tools/metronome");
    const metronomeView = page.getByTestId("standalone-metronome-view");
    await expect(metronomeView).toBeVisible();

    // BPM stepper adjustments
    await metronomeView.getByTestId("metronome-bpm-plus-5").click();
    await expect(metronomeView.getByTestId("metronome-bpm-display")).toContainText("125");
    await expect(metronomeView.getByTestId("metronome-bpm-input")).toHaveValue("125");

    // Change time signature to 3/4
    await metronomeView.getByTestId("metronome-time-signature").selectOption("3/4");
    await expect(metronomeView.getByTestId("metronome-beat-0")).toBeVisible();
    await expect(metronomeView.getByTestId("metronome-beat-1")).toBeVisible();
    await expect(metronomeView.getByTestId("metronome-beat-2")).toBeVisible();
    await expect(metronomeView.getByTestId("metronome-beat-3")).toHaveCount(0);

    // Subdivisions
    await metronomeView.getByTestId("metronome-subdivisions").selectOption("2");

    // Accent toggle
    const accent = metronomeView.getByTestId("metronome-accent");
    await expect(accent).toBeChecked();
    await accent.uncheck();
    await expect(accent).not.toBeChecked();

    // Start / stop toggle
    const toggle = metronomeView.getByTestId("metronome-toggle");
    await expect(toggle).toContainText("Start");
    await toggle.click();
    await expect(toggle).toContainText("Stop");
    await toggle.click();
    await expect(toggle).toContainText("Start");
  });
});
