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
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
}

async function enter3d(page) {
  await page.selectOption("#graphView", "3d");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "3d");
  await expect(page.locator("#graph > canvas")).toHaveCount(1);
  await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(1);
}

async function rendererModule(page) {
  return page.evaluate(async () => Boolean(await import("./src/three-renderer.js")));
}

async function liveSnapshot(page) {
  return page.evaluate(async () => {
    const module = await import("./src/three-renderer.js");
    return module.get3dLivePhysicsSnapshot(document.getElementById("graph"));
  });
}

async function performanceSnapshot(page) {
  return page.evaluate(async () => {
    const module = await import("./src/three-renderer.js");
    return module.get3dPerformanceSnapshot(document.getElementById("graph"));
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

async function setPhysicsOptions(page, patch) {
  return page.evaluate(async (next) => {
    const module = await import("./src/three-renderer.js");
    return module.set3dLivePhysicsOptions(document.getElementById("graph"), next);
  }, patch);
}

async function inputRange(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function linkScreenPoint(page, linkId) {
  const canvas = page.locator("#graph > canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const point = await page.evaluate((id) => {
    const graph = document.getElementById("graph");
    const label = graph?.querySelector(`[data-role="three-label-layer"] [data-link-id="${id}"]`);
    if (!graph || !label) return null;
    return {
      x: Number.parseFloat(label.style.left),
      y: Number.parseFloat(label.style.top),
    };
  }, linkId);
  if (!box || !point) return null;
  return { x: box.x + point.x, y: box.y + point.y };
}

function moved(before, after, id, epsilon = 1e-5) {
  const left = before.positions[id];
  const right = after.positions[id];
  if (!left || !right) return false;
  return Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z) > epsilon;
}

async function forceCssFullscreenFallback(page) {
  await page.locator("#graphPanel").evaluate((panel) => {
    Object.defineProperty(panel, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
  });
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test("live 3D interaction is presentation-only and sleeps without camera-driven physics wakeups", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  const semanticBefore = await page.locator("#asetJson").textContent();
  await enter3d(page);
  expect(await rendererModule(page)).toBe(true);

  const initial = await liveSnapshot(page);
  expect(initial.positions.R).toEqual({ x: 0, y: 0, z: 0 });

  await inputRange(page, "#graphCharge", 1.7);
  await inputRange(page, "#graphSpringStiffness", 0.12);
  await inputRange(page, "#graphDamping", 0.78);
  await expect.poll(async () => (await liveSnapshot(page)).options.charge).toBe(1.7);
  await expect.poll(async () => (await liveSnapshot(page)).options.springStiffness).toBe(0.12);
  await expect.poll(async () => (await liveSnapshot(page)).options.damping).toBe(0.78);

  await setSelectedLink(page, "L");
  await expect.poll(() => selectedLink(page)).toBe("L");
  const beforeDrag = await liveSnapshot(page);
  const point = await linkScreenPoint(page, "L");
  expect(point).not.toBeNull();

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 85, point.y + 30, { steps: 5 });
  await expect.poll(async () => (await liveSnapshot(page)).draggingLinkId).toBe("L");
  const duringDrag = await liveSnapshot(page);
  expect(moved(beforeDrag, duringDrag, "L", 0.02)).toBe(true);
  expect(duringDrag.positions.R).toEqual({ x: 0, y: 0, z: 0 });
  await expect.poll(async () => {
    const current = await liveSnapshot(page);
    return ["O", "C", "U"].some((id) => moved(beforeDrag, current, id));
  }).toBe(true);
  await page.mouse.up();
  await expect.poll(async () => (await liveSnapshot(page)).draggingLinkId).toBeNull();

  await page.locator("#graphPhysicsPause").click();
  await expect.poll(async () => (await liveSnapshot(page)).paused).toBe(true);
  await page.locator("#graphPhysicsReset").click();
  const resetOne = await liveSnapshot(page);
  expect(resetOne.tick).toBe(0);
  expect(resetOne.positions.R).toEqual({ x: 0, y: 0, z: 0 });
  await page.locator("#graphPhysicsReset").click();
  const resetTwo = await liveSnapshot(page);
  expect(resetTwo.positions).toEqual(resetOne.positions);
  expect(resetTwo.velocities).toEqual(resetOne.velocities);
  expect(await selectedLink(page)).toBe("L");

  await page.locator("#graphPhysicsPause").click();
  await expect.poll(async () => (await liveSnapshot(page)).paused).toBe(false);
  await setPhysicsOptions(page, {
    charge: 0,
    springStiffness: 0,
    damping: 0,
    settleVelocity: 10,
    settleEnergyTolerance: 1_000_000_000,
    settleWindow: 2,
  });
  await expect.poll(async () => (await liveSnapshot(page)).awake).toBe(false);
  const asleep = await liveSnapshot(page);
  expect(asleep.tick).toBeGreaterThanOrEqual(2);

  const canvas = page.locator("#graph > canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(150);
  const afterCamera = await liveSnapshot(page);
  expect(afterCamera.awake).toBe(false);
  expect(afterCamera.tick).toBe(asleep.tick);
  expect(afterCamera.positions).toEqual(asleep.positions);

  const performance = await performanceSnapshot(page);
  expect(performance.performanceBudget.withinBudget).toBe(true);
  expect(performance.renderedArcVertices).toBeGreaterThan(0);
  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
});

test("repeated fullscreen and 2D/3D lifecycle cycles do not accumulate renderer resources", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await enter3d(page);
  await page.locator("#graphPhysicsPause").click();
  await setSelectedLink(page, "L");
  await forceCssFullscreenFallback(page);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.locator("#graphFullscreen").click();
    await expect(page.locator("#graphPanel")).toHaveClass(/graph-fullscreen-fallback/);
    await expect(page.locator("#graph > canvas")).toHaveCount(1);
    await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(1);
    expect(await rendererActive(page)).toBe(true);
    expect(await selectedLink(page)).toBe("L");
    expect((await liveSnapshot(page)).paused).toBe(true);

    await page.locator("#graphFullscreen").click();
    await expect(page.locator("#graphPanel")).not.toHaveClass(/graph-fullscreen-fallback/);
    await expect(page.locator("#graph > canvas")).toHaveCount(1);
    await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(1);

    await page.selectOption("#graphView", "2d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
    expect(await rendererActive(page)).toBe(false);
    await expect(page.locator("#graph > canvas")).toHaveCount(0);
    await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(0);

    await enter3d(page);
    await expect(page.locator("#graph > canvas")).toHaveCount(1);
    await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(1);
    expect(await rendererActive(page)).toBe(true);
  }
});
