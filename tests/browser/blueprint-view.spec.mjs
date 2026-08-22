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
    provenance: { status: "browser-blueprint-fixture" },
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

async function enterBlueprint(page) {
  await page.selectOption("#graphView", "blueprint");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "blueprint");
  await expect(page.locator('#graph > [data-role="blueprint-svg"]')).toHaveCount(1);
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const module = await import("./src/blueprint-renderer.js");
    return module.getBlueprintRendererSnapshot(document.getElementById("graph"));
  });
}

async function centerScreenPoint(page, linkId) {
  const center = page.locator(`[data-role="blueprint-center"][data-link-id="${linkId}"]`);
  await center.scrollIntoViewIfNeeded();
  const box = await center.boundingBox();
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function pathData(page, linkId, role) {
  return page
    .locator(`[data-role="blueprint-link"][data-link-id="${linkId}"] [data-role="${role}"]`)
    .getAttribute("d");
}

function moved(before, after, linkId, epsilon = 0.01) {
  const left = before.positions[linkId];
  const right = after.positions[linkId];
  return Math.hypot(right.x - left.x, right.y - left.y) > epsilon;
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test("blueprint is a third native SVG view with semantic RGB and one spline per link", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await expect(page.locator('#graphView option[value="2d"]')).toHaveCount(1);
  await expect(page.locator('#graphView option[value="blueprint"]')).toHaveText("2D — blueprint связей");
  await expect(page.locator('#graphView option[value="3d"]')).toHaveCount(1);

  const semanticBefore = await page.locator("#asetJson").textContent();
  await enterBlueprint(page);

  await expect(page.locator('[data-role="blueprint-center"]')).toHaveCount(5);
  await expect(page.locator('[data-role="blueprint-link"]')).toHaveCount(5);
  await expect(page.locator(".blueprint-curve")).toHaveCount(10);
  await expect(page.locator('[data-role="blueprint-label"]')).toHaveCount(5);
  await expect(page.locator('#graph > [data-role="blueprint-svg"]')).toHaveCount(1);
  await expect(page.locator("#graph > canvas")).toHaveCount(0);

  const rendered = await snapshot(page);
  expect(rendered.linkCount).toBe(5);
  expect(rendered.centerCount).toBe(5);
  expect(rendered.pathCount).toBe(10);
  expect(rendered.svgCount).toBe(1);

  const colors = await page.locator("#graph defs stop").evaluateAll((stops) =>
    stops.map((stop) => stop.getAttribute("stop-color")),
  );
  expect(colors).toContain("#ff657a");
  expect(colors).toContain("#67e8b3");
  expect(colors).toContain("#73a7ff");
  await expect(page.locator('#blueprint-end-arrow path')).toHaveAttribute("fill", "#73a7ff");

  const root = page.locator('[data-role="blueprint-center"][data-link-id="R"]');
  await expect(root.locator(".blueprint-center-dot")).toHaveClass(/root/);
  const rootStart = await pathData(page, "R", "blueprint-start-path");
  const rootEnd = await pathData(page, "R", "blueprint-end-path");
  expect(rootStart).toMatch(/^M /);
  expect(rootEnd).toMatch(/^M /);
  expect(rootStart.length + rootEnd.length).toBeGreaterThan(80);

  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
  await expect(page.locator("#graphPhysicsControls")).toBeHidden();
  await expect(page.locator("#graphFullscreen")).toBeHidden();
  await expect(page.locator("#graphLayout")).toBeDisabled();
});

test("dragging a blueprint center repins dependent links and survives view switching", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await enterBlueprint(page);

  const semanticBefore = await page.locator("#asetJson").textContent();
  const before = await snapshot(page);
  const lStartBefore = await pathData(page, "L", "blueprint-start-path");
  const uEndBefore = await pathData(page, "U", "blueprint-end-path");
  const point = await centerScreenPoint(page, "O");
  expect(point).not.toBeNull();

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 90, point.y + 45, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => moved(before, await snapshot(page), "O", 1)).toBe(true);
  const afterDrag = await snapshot(page);
  expect(afterDrag.selectedLinkId).toBe("O");
  expect(await pathData(page, "L", "blueprint-start-path")).not.toBe(lStartBefore);
  expect(await pathData(page, "U", "blueprint-end-path")).not.toBe(uEndBefore);

  const scaleBeforeZoom = afterDrag.scale;
  await page.locator("#graphZoomIn").click();
  await expect.poll(async () => (await snapshot(page)).scale).toBeGreaterThan(scaleBeforeZoom);
  await page.locator("#graphFit").click();
  const afterFit = await snapshot(page);
  expect(Number.isFinite(afterFit.scale)).toBe(true);
  expect(afterFit.scale).toBeGreaterThan(0);

  const draggedPosition = afterFit.positions.O;
  await page.selectOption("#graphView", "2d");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
  await expect(page.locator('[data-role="blueprint-svg"]')).toHaveCount(0);
  await expect(page.locator("#graphLayout")).toBeEnabled();

  await enterBlueprint(page);
  const restored = await snapshot(page);
  expect(restored.positions.O).toEqual(draggedPosition);
  expect(restored.selectedLinkId).toBe("O");
  await expect(page.locator('#graph > [data-role="blueprint-svg"]')).toHaveCount(1);
  await expect(page.locator(".blueprint-curve")).toHaveCount(10);
  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
});
