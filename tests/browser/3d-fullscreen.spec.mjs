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
    provenance: { status: "browser-fullscreen-fixture" },
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

async function snapshot(page) {
  return page.evaluate(async () => {
    const module = await import("./generated/mts-visual/three/index.js");
    const graph = document.getElementById("graph");
    return {
      renderer: module.getVisualThreeRendererSnapshot(graph) ?? null,
      live: module.hasVisualThreeLiveController(graph),
    };
  });
}

async function enter3d(page) {
  await page.selectOption("#graphView", "3d");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "3d");
  await expect(page.locator("#graph > canvas")).toHaveCount(1);
  await expect.poll(async () => (await snapshot(page)).live).toBe(true);
}

async function inputRange(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function forceCssFullscreenFallback(page) {
  await page.locator("#graphPanel").evaluate((panel) => {
    Object.defineProperty(panel, "requestFullscreen", { configurable: true, value: undefined });
  });
}

async function expectViewportPanel(page) {
  await expect.poll(async () => {
    const box = await page.locator("#graphPanel").boundingBox();
    const viewport = page.viewportSize();
    return Boolean(box && viewport
      && Math.abs(box.x) <= 1
      && Math.abs(box.y) <= 1
      && Math.abs(box.width - viewport.width) <= 2
      && Math.abs(box.height - viewport.height) <= 2);
  }).toBe(true);
}

test.beforeEach(async ({ page }) => { await boot(page); });

test("3D fullscreen fallback fills viewport and preserves shared renderer/control state across resize and exit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await expect(page.locator("#graphFullscreen")).toBeHidden();
  await enter3d(page);
  await expect(page.locator("#graphFullscreen")).toBeVisible();

  await page.locator("#graphPhysicsPause").click();
  await inputRange(page, "#graphCharge", 1.65);
  await inputRange(page, "#graphSpringStiffness", 0.11);
  await inputRange(page, "#graphDamping", 0.74);
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");
  const before = await snapshot(page);
  expect(before.live).toBe(true);
  expect(before.renderer).toMatchObject({ mounted: true, nodeCount: 5, arcCount: 10 });

  await forceCssFullscreenFallback(page);
  await page.locator("#graphFullscreen").click();
  await expect(page.locator("#graphPanel")).toHaveClass(/graph-fullscreen-fallback/);
  await expect(page.locator("body")).toHaveClass(/graph-fullscreen-active/);
  await expect(page.locator("#graphFullscreen")).toHaveAttribute("aria-pressed", "true");
  await expectViewportPanel(page);
  await expect(page.locator("#graph > canvas")).toHaveCount(1);

  const fullscreen = await snapshot(page);
  expect(fullscreen.live).toBe(true);
  expect(fullscreen.renderer.nodeCount).toBe(before.renderer.nodeCount);
  expect(fullscreen.renderer.arcCount).toBe(before.renderer.arcCount);
  expect(fullscreen.renderer.width).toBeGreaterThan(before.renderer.width);
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");
  await expect(page.locator("#graphChargeValue")).toHaveText("1.65");
  await expect(page.locator("#graphSpringStiffnessValue")).toHaveText("0.110");
  await expect(page.locator("#graphDampingValue")).toHaveText("0.74");

  await page.setViewportSize({ width: 1180, height: 760 });
  await expectViewportPanel(page);
  await expect.poll(async () => (await snapshot(page)).renderer.width).toBeGreaterThan(900);

  await page.locator("#graphFullscreen").click();
  await expect(page.locator("#graphPanel")).not.toHaveClass(/graph-fullscreen-fallback/);
  await expect(page.locator("body")).not.toHaveClass(/graph-fullscreen-active/);
  await expect(page.locator("#graphFullscreen")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#graphFullscreen")).toHaveText("На весь экран");
  const afterExit = await snapshot(page);
  expect(afterExit.live).toBe(true);
  expect(afterExit.renderer.nodeCount).toBe(5);
  expect(afterExit.renderer.arcCount).toBe(10);
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");

  await page.locator("#graphFullscreen").click();
  await expectViewportPanel(page);
  await page.locator("#graphFullscreen").click();
  await expect(page.locator("#graphFullscreen")).toHaveAttribute("aria-pressed", "false");
  expect((await snapshot(page)).live).toBe(true);
  await expect(page.locator("#graph > canvas")).toHaveCount(1);
});
