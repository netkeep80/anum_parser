import { chromium, expect, test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173";

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
    provenance: { status: "browser-blueprint-contract-fixture" },
  };
}

async function boot(page) {
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("Готово");
}

async function loadKernel(page) {
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

async function blueprintSnapshot(page) {
  return page.evaluate(async () => {
    const module = await import("./src/blueprint-renderer.js");
    return module.getBlueprintRendererSnapshot(document.getElementById("graph"));
  });
}

async function rendererActivity(page) {
  return page.evaluate(async () => {
    const [blueprint, three] = await Promise.all([
      import("./src/blueprint-renderer.js"),
      import("./src/three-renderer.js"),
    ]);
    const graph = document.getElementById("graph");
    return {
      blueprint: blueprint.hasBlueprintRenderer(graph),
      three: three.has3dRenderer(graph),
    };
  });
}

async function centerScreenPoint(page, linkId) {
  const center = page.locator(`[data-role="blueprint-center"][data-link-id="${linkId}"]`);
  await center.scrollIntoViewIfNeeded();
  const box = await center.boundingBox();
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function linkColors(page) {
  return page.locator('[data-role="blueprint-link"]').evaluateAll((groups) => Object.fromEntries(
    groups.map((group) => {
      const path = group.querySelector('[data-role="blueprint-link-path"]');
      return [group.getAttribute("data-link-id"), path?.getAttribute("stroke")];
    }),
  ));
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test("debugger and selection stay presentation-only without recoloring blueprint links", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await page.selectOption("#sample", "12");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("Готово");
  const semanticBefore = await page.locator("#asetJson").textContent();
  await enterBlueprint(page);

  const root = page.locator('[data-role="blueprint-center"][data-link-id="R"]');
  await root.click();
  await expect.poll(async () => (await blueprintSnapshot(page))?.selectedLinkId).toBe("R");

  const colorsBefore = await linkColors(page);
  expect(Object.keys(colorsBefore).length).toBeGreaterThan(0);
  expect(new Set(Object.values(colorsBefore)).size).toBe(Object.keys(colorsBefore).length);
  await expect(page.locator("#graph defs stop")).toHaveCount(0);

  const last = await page.locator("#debugStep").textContent();
  await page.locator("#debugFirst").click();
  await expect(page.locator("#debugStep")).not.toHaveText(last);
  await expect(page.locator("#debugCurrent")).toContainText("операция:");
  await expect(page.locator(".blueprint-debug-hidden").first()).toBeAttached();
  expect((await blueprintSnapshot(page))?.svgCount).toBe(1);

  await page.locator("#debugNext").click();
  await expect(page.locator("#debugEffects")).toContainText("видимых связей:");
  expect((await blueprintSnapshot(page))?.svgCount).toBe(1);
  expect(await linkColors(page)).toEqual(colorsBefore);
  expect((await blueprintSnapshot(page))?.linkColors).toEqual(colorsBefore);
  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
});

test("repeated 2D/blueprint/3D cycles keep exactly one active renderer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await loadKernel(page);
  const semanticBefore = await page.locator("#asetJson").textContent();

  for (let cycle = 0; cycle < 4; cycle += 1) {
    await enterBlueprint(page);
    expect(await rendererActivity(page)).toEqual({ blueprint: true, three: false });
    await expect(page.locator('#graph > [data-role="blueprint-svg"]')).toHaveCount(1);
    await expect(page.locator('[data-role="blueprint-link-path"]')).toHaveCount(5);
    await expect(page.locator("#graph > canvas")).toHaveCount(0);

    await page.selectOption("#graphView", "3d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "3d");
    expect(await rendererActivity(page)).toEqual({ blueprint: false, three: true });
    await expect(page.locator('[data-role="blueprint-svg"]')).toHaveCount(0);
    await expect(page.locator("#graph > canvas")).toHaveCount(1);
    await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(1);

    await page.selectOption("#graphView", "2d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
    expect(await rendererActivity(page)).toEqual({ blueprint: false, three: false });
    await expect(page.locator('[data-role="blueprint-svg"]')).toHaveCount(0);
    await expect(page.locator("#graph > canvas")).toHaveCount(0);
    await expect(page.locator('[data-role="three-label-layer"]')).toHaveCount(0);
  }

  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
});

test("dragged blueprint geometry remains finite after viewport resize and fit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await loadKernel(page);
  await enterBlueprint(page);
  const semanticBefore = await page.locator("#asetJson").textContent();
  const before = await blueprintSnapshot(page);
  const colorsBefore = await linkColors(page);
  const point = await centerScreenPoint(page, "O");
  expect(point).not.toBeNull();

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 100, point.y + 50, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => {
    const after = await blueprintSnapshot(page);
    return Math.hypot(
      after.positions.O.x - before.positions.O.x,
      after.positions.O.y - before.positions.O.y,
    );
  }).toBeGreaterThan(1);

  await page.setViewportSize({ width: 920, height: 700 });
  await page.locator("#graphFit").click();
  const afterResize = await blueprintSnapshot(page);
  expect(Number.isFinite(afterResize.scale)).toBe(true);
  expect(afterResize.scale).toBeGreaterThan(0);
  expect(Number.isFinite(afterResize.pan.x)).toBe(true);
  expect(Number.isFinite(afterResize.pan.y)).toBe(true);
  expect(afterResize.svgCount).toBe(1);
  expect(afterResize.pathCount).toBe(5);
  expect(afterResize.linkColors).toEqual(before.linkColors);
  expect(await linkColors(page)).toEqual(colorsBefore);
  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
});

test("WebGL fallback returns to structural 2D without disabling blueprint", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-webgl", "--disable-webgl2", "--disable-gpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(BASE_URL);
    await expect(page.locator("#status")).toContainText("Готово");
    await loadKernel(page);
    const semanticBefore = await page.locator("#asetJson").textContent();

    await enterBlueprint(page);
    expect(await rendererActivity(page)).toEqual({ blueprint: true, three: false });
    await page.selectOption("#graphView", "3d");
    await expect(page.locator("#graphView")).toHaveValue("2d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
    await expect(page.locator("#status")).toContainText("3D недоступен");
    expect(await rendererActivity(page)).toEqual({ blueprint: false, three: false });

    await enterBlueprint(page);
    await page.locator("#graphFit").click();
    expect(await rendererActivity(page)).toEqual({ blueprint: true, three: false });
    expect((await blueprintSnapshot(page))?.svgCount).toBe(1);
    expect((await blueprintSnapshot(page))?.pathCount).toBe(5);
    expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
  } finally {
    await browser.close();
  }
});
