import { expect, test } from "@playwright/test";

function kernelAset() {
  return {
    format: "mts-aset", version: "0.2", identity: "by-poles", root: "R",
    links: [
      { id: "R", start: "R", end: "R", tags: ["root"] },
      { id: "O", start: "O", end: "R", tags: ["root-abit", "opening"] },
      { id: "C", start: "R", end: "C", tags: ["root-abit", "closing"] },
      { id: "L", start: "O", end: "C", tags: ["root-abit", "linked"] },
      { id: "U", start: "C", end: "O", tags: ["root-abit", "unlinked"] },
    ],
    labels: { R: "∞", O: "[", C: "]", L: "1", U: "0" },
    symbolSequences: [], abitSequences: [], linkSequences: [], rootChains: [], storedAnums: [],
    provenance: { status: "browser-live-controls-fixture" },
  };
}

async function boot(page) {
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("Готово");
  await page.selectOption("#inputFormat", "aset");
  await page.locator("#source").fill(JSON.stringify(kernelAset()));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("Готово");
}

async function rendererSnapshot(page) {
  return page.evaluate(async () => {
    const module = await import("./generated/mts-visual/three/index.js");
    return module.getVisualThreeRendererSnapshot(document.getElementById("graph")) ?? null;
  });
}

async function enter3d(page) {
  await page.selectOption("#graphView", "3d");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "3d");
  await expect(page.locator("#graph > canvas")).toHaveCount(1);
  await expect(page.locator("#graphPhysicsControls")).toBeVisible();
  await expect.poll(async () => Boolean(await rendererSnapshot(page))).toBe(true);
}

async function inputRange(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test.beforeEach(async ({ page }) => { await boot(page); });

test("live physics sliders, pause/resume and reset operate through the shared renderer without semantic mutation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await expect(page.locator("#graphPhysicsControls")).toBeHidden();
  const semanticBefore = await page.locator("#asetJson").textContent();
  await enter3d(page);
  const canvas = page.locator("#graph > canvas");

  await expect(page.locator("#graphChargeValue")).toHaveText("1.00");
  await expect(page.locator("#graphSpringStiffnessValue")).toHaveText("0.055");
  await expect(page.locator("#graphDampingValue")).toHaveText("0.86");

  await page.locator("#graphPhysicsPause").click();
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");
  const paused = await canvas.screenshot();
  await page.waitForTimeout(160);
  expect((await canvas.screenshot()).equals(paused)).toBe(true);

  await inputRange(page, "#graphCharge", 1.75);
  await inputRange(page, "#graphSpringStiffness", 0.12);
  await inputRange(page, "#graphDamping", 0.72);
  await expect(page.locator("#graphChargeValue")).toHaveText("1.75");
  await expect(page.locator("#graphSpringStiffnessValue")).toHaveText("0.120");
  await expect(page.locator("#graphDampingValue")).toHaveText("0.72");
  expect((await canvas.screenshot()).equals(paused)).toBe(true);

  await page.locator("#graphPhysicsPause").click();
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Пауза");
  await expect.poll(async () => (await canvas.screenshot()).equals(paused)).toBe(false);

  await page.locator("#graphPhysicsPause").click();
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");
  await page.locator("#graphPhysicsReset").click();
  await expect.poll(async () => Boolean(await rendererSnapshot(page))).toBe(true);
  const resetOne = await canvas.screenshot();
  await page.locator("#graphPhysicsReset").click();
  const resetTwo = await canvas.screenshot();
  expect(resetTwo.equals(resetOne)).toBe(true);

  const snapshot = await rendererSnapshot(page);
  expect(snapshot).toMatchObject({ mounted: true, nodeCount: 5, arcCount: 10 });
  await expect(page.locator("#graphChargeValue")).toHaveText("1.75");
  await expect(page.locator("#graphSpringStiffnessValue")).toHaveText("0.120");
  await expect(page.locator("#graphDampingValue")).toHaveText("0.72");
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");
  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
});
