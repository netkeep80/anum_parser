import { expect, test } from "@playwright/test";

function kernelAset() {
  return {
    format: "mts-aset",
    version: "0.2",
    identity: "by-poles",
    root: "R",
    links: [
      { id: "R", start: "R", end: "R", tags: ["root"] },
      { id: "O", start: "O", end: "R", tags: ["root-abit", "opening"] },
      { id: "C", start: "R", end: "C", tags: ["root-abit", "closing"] },
      { id: "L", start: "O", end: "C", tags: ["root-abit", "linked"] },
      { id: "U", start: "C", end: "O", tags: ["root-abit", "unlinked"] },
    ],
    labels: { R: "∞", O: "[", C: "]", L: "1", U: "0" },
    symbolSequences: [],
    abitSequences: [],
    linkSequences: [],
    rootChains: [],
    storedAnums: [],
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
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
}

async function enter3d(page) {
  await page.selectOption("#graphView", "3d");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "3d");
  await expect(page.locator("#graph > canvas")).toHaveCount(1);
  await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(1);
}

async function liveSnapshot(page) {
  return page.evaluate(async () => {
    const module = await import("./src/three-renderer.js");
    return module.get3dLivePhysicsSnapshot(document.getElementById("graph"));
  });
}

async function rendererActive(page) {
  return page.evaluate(async () => {
    const module = await import("./src/three-renderer.js");
    return module.has3dRenderer(document.getElementById("graph"));
  });
}

async function selectedLink(page) {
  return page.evaluate(async () => {
    const module = await import("./src/three-renderer.js");
    return module.get3dSelectedLink(document.getElementById("graph"));
  });
}

async function setSelectedLink(page, linkId) {
  await page.evaluate(async (id) => {
    const module = await import("./src/three-renderer.js");
    module.set3dSelectedLink(document.getElementById("graph"), id);
  }, linkId);
}

async function inputRange(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function forceCssFullscreenFallback(page) {
  await page.locator("#graphPanel").evaluate((panel) => {
    Object.defineProperty(panel, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
  });
}

async function expectViewportPanel(page) {
  await expect.poll(async () => {
    const box = await page.locator("#graphPanel").boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) return false;
    return Math.abs(box.x) <= 1
      && Math.abs(box.y) <= 1
      && Math.abs(box.width - viewport.width) <= 2
      && Math.abs(box.height - viewport.height) <= 2;
  }).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test("3D fullscreen fallback fills viewport and preserves live renderer state across resize and exit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await expect(page.locator("#graphFullscreen")).toBeHidden();
  await enter3d(page);
  await expect(page.locator("#graphFullscreen")).toBeVisible();

  await page.locator("#graphPhysicsPause").click();
  await inputRange(page, "#graphCharge", 1.65);
  await inputRange(page, "#graphSpringStiffness", 0.11);
  await inputRange(page, "#graphDamping", 0.74);
  await setSelectedLink(page, "L");
  await expect.poll(() => selectedLink(page)).toBe("L");

  const before = await liveSnapshot(page);
  expect(before.paused).toBe(true);
  expect(before.options.charge).toBe(1.65);
  expect(before.options.springStiffness).toBe(0.11);
  expect(before.options.damping).toBe(0.74);
  expect(await rendererActive(page)).toBe(true);

  await forceCssFullscreenFallback(page);
  await page.locator("#graphFullscreen").click();
  await expect(page.locator("#graphPanel")).toHaveClass(/graph-fullscreen-fallback/);
  await expect(page.locator("body")).toHaveClass(/graph-fullscreen-active/);
  await expect(page.locator("#graphFullscreen")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#graphFullscreen")).toHaveText("Выйти из полноэкранного");
  await expectViewportPanel(page);

  await expect(page.locator("#graph > canvas")).toHaveCount(1);
  await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(1);
  expect(await rendererActive(page)).toBe(true);
  expect(await selectedLink(page)).toBe("L");

  const fullscreenState = await liveSnapshot(page);
  expect(fullscreenState.tick).toBe(before.tick);
  expect(fullscreenState.positions).toEqual(before.positions);
  expect(fullscreenState.options.charge).toBe(1.65);
  expect(fullscreenState.options.springStiffness).toBe(0.11);
  expect(fullscreenState.options.damping).toBe(0.74);
  expect(fullscreenState.paused).toBe(true);

  const firstCanvasBox = await page.locator("#graph > canvas").boundingBox();
  expect(firstCanvasBox).not.toBeNull();
  expect(firstCanvasBox.width).toBeGreaterThan(600);
  expect(firstCanvasBox.height).toBeGreaterThan(300);

  await page.setViewportSize({ width: 1180, height: 760 });
  await expectViewportPanel(page);
  await expect.poll(async () => {
    const box = await page.locator("#graph > canvas").boundingBox();
    return Boolean(box && box.width > 900 && box.height > 250 && box.height < 760);
  }).toBe(true);

  const resizedState = await liveSnapshot(page);
  expect(resizedState.tick).toBe(before.tick);
  expect(resizedState.positions).toEqual(before.positions);
  expect(await selectedLink(page)).toBe("L");

  await page.locator("#graphFullscreen").click();
  await expect(page.locator("#graphPanel")).not.toHaveClass(/graph-fullscreen-fallback/);
  await expect(page.locator("body")).not.toHaveClass(/graph-fullscreen-active/);
  await expect(page.locator("#graphFullscreen")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#graphFullscreen")).toHaveText("На весь экран");
  await expect.poll(async () => {
    const box = await page.locator("#graphPanel").boundingBox();
    const viewport = page.viewportSize();
    return Boolean(box && viewport && box.width < viewport.width - 30);
  }).toBe(true);

  const afterExit = await liveSnapshot(page);
  expect(afterExit.tick).toBe(before.tick);
  expect(afterExit.positions).toEqual(before.positions);
  expect(afterExit.options).toEqual(fullscreenState.options);
  expect(afterExit.paused).toBe(true);
  expect(await selectedLink(page)).toBe("L");
  expect(await rendererActive(page)).toBe(true);
  await expect(page.locator("#graph > canvas")).toHaveCount(1);

  await page.locator("#graphFullscreen").click();
  await expectViewportPanel(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#graphPanel")).not.toHaveClass(/graph-fullscreen-fallback/);
  await expect(page.locator("#graphFullscreen")).toHaveAttribute("aria-pressed", "false");
  expect((await liveSnapshot(page)).positions).toEqual(before.positions);
  expect(await selectedLink(page)).toBe("L");
  expect(await rendererActive(page)).toBe(true);
  await expect(page.locator("#graph > canvas")).toHaveCount(1);
  await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(1);
});