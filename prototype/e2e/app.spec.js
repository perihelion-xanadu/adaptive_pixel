import { test, expect } from "@playwright/test";

test.describe("Adaptive Mind Emergent Mind Prototype", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should render the main page and layout elements", async ({ page }) => {
    // Verify the primary page title
    await expect(page.locator("h1")).toHaveText("Emergent Mind Prototype");
    
    // Verify that the control buttons are visible
    await expect(page.getByRole("button", { name: /^▶ RUN$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "▷ STEP" })).toBeVisible();
    await expect(page.getByRole("button", { name: "↺ RESET" })).toBeVisible();

    // Verify the main simulation grid is rendered
    const cells = page.locator("div[style*='grid-template-columns'] > div");
    await expect(cells).toHaveCount(144);
  });

  test("should advance steps manually when clicking the STEP button", async ({ page }) => {
    // Locate the first agent's steps counter (it should start at 0)
    const stepsLabel = page.locator("div", { hasText: /^Steps$/ }).first();
    const stepsCounter = stepsLabel.locator("xpath=following-sibling::div");
    await expect(stepsCounter).toHaveText("0");

    // Click the STEP button
    await page.click("button:has-text('STEP')");

    // Steps should increment to 1
    await expect(stepsCounter).toHaveText("1");
  });

  test("should toggle Dual-Agent mode successfully", async ({ page }) => {
    // Verify we only have "Stats" initially
    await expect(page.locator("div", { hasText: /^Stats$/ }).first()).toBeVisible();
    await expect(page.locator("div", { hasText: /^Agent A$/ })).toHaveCount(0);

    // Toggle the Dual-Agent checkbox
    await page.click("label:has-text('Dual-Agent')");

    // Verify Agent A and Agent B stats are now rendered
    await expect(page.locator("div", { hasText: /^Agent A$/ }).first()).toBeVisible();
    await expect(page.locator("div", { hasText: /^Agent B$/ }).first()).toBeVisible();
  });

  test("should run the simulation and pause it", async ({ page }) => {
    const runButton = page.getByRole("button", { name: /^▶ RUN$/ });
    const stepsLabel = page.locator("div", { hasText: /^Steps$/ }).first();
    const stepsCounter = stepsLabel.locator("xpath=following-sibling::div");

    // Verify starts at 0
    await expect(stepsCounter).toHaveText("0");

    // Click the RUN button to start the simulation
    await runButton.click();

    // Button should transform to PAUSE
    const pauseButton = page.getByRole("button", { name: /^⏸ PAUSE$/ });
    await expect(pauseButton).toBeVisible();

    // Wait a brief moment and verify steps are incrementing automatically
    await page.waitForTimeout(1000);
    const stepsAfterRun = parseInt(await stepsCounter.innerText(), 10);
    expect(stepsAfterRun).toBeGreaterThan(0);

    // Pause the simulation
    await pauseButton.click();
    await expect(runButton).toBeVisible();

    // Verify steps are no longer incrementing
    const stepsAfterPause = parseInt(await stepsCounter.innerText(), 10);
    await page.waitForTimeout(500);
    const stepsCheck = parseInt(await stepsCounter.innerText(), 10);
    expect(stepsCheck).toBe(stepsAfterPause);
  });
});
