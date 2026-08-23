import { chromium, expect, test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173";
const COLORS = Object.freeze({ start: "#ff0000", center: "#00ff00", end: "#0000ff" });

function kernelAset(extraLinks = [], labels = {}) {
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
      ...extraLinks,
    ],
    labels: { R: "∞", O: "[", C: "]", L: "1", U: "0", ...labels },
    symbolSequences: [],
    abitSequences: [],
    linkSequences: [],
    rootChains: [],
    storedAnums: [],
    provenance: { status: "browser-fixture" },
  };
}

function chainAset(totalLinks) {
  const extras = [];
  let previous = "R";
  for (let index = 1; index <= totalLinks - 5; index += 1) {
    const id = `N${index}`;
    extras.push({ id, start: previous, end: "O" });
    previous = id;
  }
  return kernelAset(extras);
}

function branchedAset() {
  return kernelAset([
    { id: "X", start: "R", end: "O" },
    { id: "Y", start: "R", end: "U" },
    { id: "Z", start: "X", end: "Y" },
  ]);
}

function recursiveAset() {
  return kernelAset([
    { id: "X", start: "Y", end: "O" },
    { id: "Y", start: "X", end: "C" },
  ]);
}

async function boot(page) {
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("Готово");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
}

async function loadAset(page, aset) {
  if (await page.locator("#graphView").inputValue() !== "2d") {
    await page.selectOption("#graphView", "2d");
  }
  await page.selectOption("#inputFormat", "aset");
  await page.locator("#source").fill(JSON.stringify(aset));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("Готово");
  await expect(page.locator("#summary")).toContainText(`Связей${aset.links.length}`);
}

async function sharedRendererSnapshot(page) {
  return page.evaluate(async () => {
    const module = await import("./generated/mts-visual/three/index.js");
    return module.getVisualThreeRendererSnapshot(document.getElementById("graph")) ?? null;
  });
}

async function enter3d(page) {
  await page.selectOption("#graphView", "3d");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "3d");
  await expect(page.locator("#graph > canvas")).toHaveCount(1);
  await expect.poll(async () => Boolean(await sharedRendererSnapshot(page))).toBe(true);
}

async function inputRange(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function semanticPixelCounts(page, pngBuffer) {
  const dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
  return page.evaluate(async ({ dataUrl, colors }) => {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    image.src = dataUrl;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = (hex) => [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ];
    const targets = Object.fromEntries(Object.entries(colors).map(([key, hex]) => [key, rgb(hex)]));
    const counts = { start: 0, center: 0, end: 0 };
    for (let index = 0; index < pixels.length; index += 4) {
      for (const [key, target] of Object.entries(targets)) {
        if (Math.max(
          Math.abs(pixels[index] - target[0]),
          Math.abs(pixels[index + 1] - target[1]),
          Math.abs(pixels[index + 2] - target[2]),
        ) <= 55) counts[key] += 1;
      }
    }
    return counts;
  }, { dataUrl, colors: COLORS });
}

async function publicHaloPoint(page, key) {
  const applied = await page.evaluate(async (targetKey) => {
    const module = await import("./generated/mts-visual/three/index.js");
    return module.setVisualThreePresentation(document.getElementById("graph"), {
      links: [{
        key: targetKey,
        halo: { color: 0xff00ff, scale: 2.8, opacity: 1 },
      }],
    });
  }, key);
  expect(applied).toBe(true);

  const canvas = page.locator("#graph > canvas");
  await canvas.scrollIntoViewIfNeeded();
  const viewport = page.viewportSize();
  if (!viewport) return null;
  const png = await page.screenshot();
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const relative = await page.evaluate(async (url) => {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    image.src = url;
    await loaded;
    const scratch = document.createElement("canvas");
    scratch.width = image.width;
    scratch.height = image.height;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, scratch.width, scratch.height).data;
    let minX = scratch.width;
    let minY = scratch.height;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    for (let y = 0; y < scratch.height; y += 1) {
      for (let x = 0; x < scratch.width; x += 1) {
        const offset = (y * scratch.width + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        if (r < 160 || b < 160 || g > 110 || Math.min(r, b) - g < 80) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count += 1;
      }
    }
    if (
      count < 4 || maxX < minX || maxY < minY
      || minX <= 2 || minY <= 2
      || maxX >= scratch.width - 3 || maxY >= scratch.height - 3
    ) return null;
    return {
      x: ((minX + maxX) / 2) / scratch.width,
      y: ((minY + maxY) / 2) / scratch.height,
    };
  }, dataUrl);
  return relative ? { x: relative.x * viewport.width, y: relative.y * viewport.height } : null;
}

async function forceCssFullscreenFallback(page) {
  await page.locator("#graphPanel").evaluate((panel) => {
    Object.defineProperty(panel, "requestFullscreen", { configurable: true, value: undefined });
  });
}

test.beforeEach(async ({ page }) => { await boot(page); });

test("published _site mounts standalone renderer with visible RGB and END arrows", async ({ page }, testInfo) => {
  await loadAset(page, kernelAset());
  await enter3d(page);
  const contract = await page.evaluate(async () => {
    const module = await import("./generated/mts-visual/three/index.js");
    return {
      colors: module.VISUAL_THREE_COLORS,
      hasLiveRenderer: typeof module.createVisualThreeLiveRenderer === "function",
      hasPresentation: typeof module.setVisualThreePresentation === "function",
      hasPause: typeof module.setVisualThreeLivePaused === "function",
    };
  });
  expect(contract).toEqual({
    colors: { startOuter: 0xff0000, center: 0x00ff00, endOuter: 0x0000ff },
    hasLiveRenderer: true,
    hasPresentation: true,
    hasPause: true,
  });
  const snapshot = await sharedRendererSnapshot(page);
  expect(snapshot).toMatchObject({ mounted: true, nodeCount: 5, arcCount: 10 });
  expect(snapshot.arrowCount).toBeGreaterThan(0);
  const screenshot = await page.locator("#graph > canvas").screenshot();
  const counts = await semanticPixelCounts(page, screenshot);
  expect(counts.start).toBeGreaterThan(0);
  expect(counts.center).toBeGreaterThan(10);
  expect(counts.end).toBeGreaterThan(0);
  await testInfo.attach("shared-3d-semantic-rgb.png", { body: screenshot, contentType: "image/png" });
});

test("shared live controls, fit, zoom and fullscreen remain operational", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await loadAset(page, branchedAset());
  await enter3d(page);
  const canvas = page.locator("#graph > canvas");
  await page.locator("#graphPhysicsPause").click();
  const paused = await canvas.screenshot();
  await inputRange(page, "#graphCharge", 2.2);
  await inputRange(page, "#graphSpringStiffness", 0.11);
  await inputRange(page, "#graphDamping", 0.72);
  await expect(page.locator("#graphChargeValue")).toHaveText("2.20");
  await expect(page.locator("#graphSpringStiffnessValue")).toHaveText("0.110");
  await expect(page.locator("#graphDampingValue")).toHaveText("0.72");
  await page.locator("#graphPhysicsPause").click();
  await expect.poll(async () => (await canvas.screenshot()).equals(paused)).toBe(false);
  await page.locator("#graphPhysicsPause").click();

  await page.locator("#graphFit").click();
  const fitted = await sharedRendererSnapshot(page);
  await page.locator("#graphZoomIn").click();
  const zoomed = await sharedRendererSnapshot(page);
  expect(zoomed.cameraPosition).not.toEqual(fitted.cameraPosition);

  await forceCssFullscreenFallback(page);
  await page.locator("#graphFullscreen").click();
  await expect(page.locator("#graphFullscreen")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#graphPanel")).toHaveClass(/graph-fullscreen-fallback/);
  await page.locator("#graphFullscreen").click();
  await expect(page.locator("#graphFullscreen")).toHaveAttribute("aria-pressed", "false");
});

test("debugger updates generic shared presentation without destroying renderer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await page.selectOption("#sample", "12");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("Готово");
  await enter3d(page);
  const before = await sharedRendererSnapshot(page);
  const last = await page.locator("#debugStep").textContent();
  await page.locator("#debugFirst").click();
  await expect(page.locator("#debugStep")).not.toHaveText(last);
  await expect(page.locator("#debugCurrent")).toContainText("операция:");
  const after = await sharedRendererSnapshot(page);
  expect(after.nodeCount).toBe(before.nodeCount);
  expect(after.arcCount).toBe(before.arcCount);
  await page.locator("#debugNext").click();
  await expect(page.locator("#debugEffects")).toContainText("видимых связей:");
  expect(await sharedRendererSnapshot(page)).not.toBeNull();
});

test("repeated 2D/3D switching disposes and recreates only shared renderer state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await loadAset(page, branchedAset());
  for (let cycle = 0; cycle < 4; cycle += 1) {
    await enter3d(page);
    await expect(page.locator("#graph > canvas")).toHaveCount(1);
    expect(await sharedRendererSnapshot(page)).not.toBeNull();
    await page.selectOption("#graphView", "2d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
    await expect(page.locator("#graph > canvas")).toHaveCount(0);
    expect(await sharedRendererSnapshot(page)).toBeNull();
  }
});

test("branched, recursive and dense Asets open through shared renderer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  for (const aset of [branchedAset(), recursiveAset(), chainAset(45)]) {
    await loadAset(page, aset);
    await enter3d(page);
    const snapshot = await sharedRendererSnapshot(page);
    expect(snapshot.nodeCount).toBe(aset.links.length);
    expect(snapshot.arcCount).toBe(aset.links.length * 2);
    expect(snapshot.arrowCount).toBeGreaterThan(0);
  }
});

test("touch viewport initializes shared 3D and activates an exact VisualKey", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-touch");
  const aset = kernelAset();
  await loadAset(page, aset);
  await enter3d(page);
  await page.locator("#graphPhysicsPause").click();
  await page.locator("#graphFit").click({ force: true });
  let target = null;
  for (const link of aset.links) {
    const point = await publicHaloPoint(page, link.id);
    if (point) {
      target = { key: link.id, point };
      break;
    }
  }
  expect(target, "at least one exact VisualKey halo must be fully visible in touch viewport").not.toBeNull();
  await page.touchscreen.tap(target.point.x, target.point.y);
  await expect(page.locator("#graph")).toHaveAttribute("data-selected-link", target.key);
});

test("WebGL failure falls back to structural 2D", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  const browser = await chromium.launch({ headless: true, args: ["--disable-webgl", "--disable-webgl2", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(BASE_URL);
    await expect(page.locator("#status")).toContainText("Готово");
    await loadAset(page, kernelAset());
    await page.selectOption("#graphView", "3d");
    await expect(page.locator("#graphView")).toHaveValue("2d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
    await expect(page.locator("#status")).toContainText("3D недоступен");
    await expect(page.locator("#graph > canvas")).toHaveCount(0);
  } finally {
    await browser.close();
  }
});
