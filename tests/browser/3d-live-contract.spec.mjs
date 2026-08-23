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
    provenance: { status: "browser-live-contract-fixture" },
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

async function sharedState(page) {
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
  await expect.poll(async () => (await sharedState(page)).live).toBe(true);
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

test.beforeEach(async ({ page }) => { await boot(page); });

test("shared live 3D stays presentation-only under physics and camera interaction", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  const semanticBefore = await page.locator("#asetJson").textContent();
  await enter3d(page);
  const canvas = page.locator("#graph > canvas");
  const initial = await sharedState(page);
  expect(initial.renderer).toMatchObject({ mounted: true, nodeCount: 5, arcCount: 10 });
  expect(initial.renderer.arrowCount).toBeGreaterThan(0);

  await page.locator("#graphPhysicsPause").click();
  const paused = await canvas.screenshot();
  await inputRange(page, "#graphCharge", 1.7);
  await inputRange(page, "#graphSpringStiffness", 0.12);
  await inputRange(page, "#graphDamping", 0.78);
  await page.locator("#graphPhysicsPause").click();
  await expect.poll(async () => (await canvas.screenshot()).equals(paused)).toBe(false);

  await page.locator("#graphPhysicsPause").click();
  const beforeCamera = await sharedState(page);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  await expect.poll(async () => {
    const after = await sharedState(page);
    return JSON.stringify(after.renderer.cameraPosition) !== JSON.stringify(beforeCamera.renderer.cameraPosition);
  }).toBe(true);
  const afterCamera = await sharedState(page);
  expect(afterCamera.renderer.nodeCount).toBe(5);
  expect(afterCamera.renderer.arcCount).toBe(10);
  expect(afterCamera.live).toBe(true);
  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
});

test("repeated fullscreen and 2D/3D lifecycle cycles do not accumulate shared renderer resources", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  const semanticBefore = await page.locator("#asetJson").textContent();
  await enter3d(page);
  await page.locator("#graphPhysicsPause").click();
  await forceCssFullscreenFallback(page);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.locator("#graphFullscreen").click();
    await expect(page.locator("#graphPanel")).toHaveClass(/graph-fullscreen-fallback/);
    await expect(page.locator("#graph > canvas")).toHaveCount(1);
    expect((await sharedState(page)).live).toBe(true);

    await page.locator("#graphFullscreen").click();
    await expect(page.locator("#graphPanel")).not.toHaveClass(/graph-fullscreen-fallback/);
    await page.selectOption("#graphView", "2d");
    await expect(page.locator("#graph > canvas")).toHaveCount(0);
    expect((await sharedState(page)).renderer).toBeNull();
    expect((await sharedState(page)).live).toBe(false);

    await enter3d(page);
    const current = await sharedState(page);
    expect(current.renderer).toMatchObject({ mounted: true, nodeCount: 5, arcCount: 10 });
    await expect(page.locator("#graph > canvas")).toHaveCount(1);
  }
  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
});
