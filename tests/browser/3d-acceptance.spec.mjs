import { chromium, expect, test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173";
const COLORS = Object.freeze({
  start: "#ff0000",
  center: "#00ff00",
  end: "#0000ff",
});

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

function rootOnlyAset() {
  return {
    ...kernelAset(),
    links: [{ id: "R", start: "R", end: "R", tags: ["root"] }],
    labels: { R: "∞" },
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
  await expect(page.locator("#graphView")).toHaveValue("2d");
}

async function loadAset(page, aset) {
  if (await page.locator("#graphView").inputValue() !== "2d") {
    await page.selectOption("#graphView", "2d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
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

async function rendererActive(page) {
  return Boolean(await sharedRendererSnapshot(page));
}

async function selectedLink(page) {
  return page.locator("#graph").getAttribute("data-selected-link");
}

async function enter3d(page) {
  await page.selectOption("#graphView", "3d");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "3d");
  await expect(page.locator("#graph > canvas")).toHaveCount(1);
  await expect.poll(() => rendererActive(page)).toBe(true);
}

async function sharedThreeContract(page) {
  return page.evaluate(async () => {
    const module = await import("./generated/mts-visual/three/index.js");
    return {
      colors: module.VISUAL_THREE_COLORS,
      hasLiveRenderer: typeof module.createVisualThreeLiveRenderer === "function",
      hasPresentation: typeof module.setVisualThreePresentation === "function",
      hasPause: typeof module.setVisualThreeLivePaused === "function",
    };
  });
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
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      for (const [key, target] of Object.entries(targets)) {
        if (Math.max(
          Math.abs(r - target[0]),
          Math.abs(g - target[1]),
          Math.abs(b - target[2]),
        ) <= 55) counts[key] += 1;
      }
    }
    return counts;
  }, { dataUrl, colors: COLORS });
}

async function denseGreenNodePoint(page) {
  const canvas = page.locator("#graph > canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) return null;
  const pngBuffer = await canvas.screenshot();
  const dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
  const relative = await page.evaluate(async (url) => {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    image.src = url;
    await loaded;
    const scratch = document.createElement("canvas");
    scratch.width = image.width;
    scratch.height = image.height;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, scratch.width, scratch.height).data;
    const green = (x, y) => {
      if (x < 0 || y < 0 || x >= scratch.width || y >= scratch.height) return false;
      const index = (y * scratch.width + x) * 4;
      return data[index] < 70 && data[index + 1] > 190 && data[index + 2] < 70;
    };
    let best = null;
    for (let y = 4; y < scratch.height - 4; y += 2) {
      for (let x = 4; x < scratch.width - 4; x += 2) {
        if (!green(x, y)) continue;
        let density = 0;
        for (let dy = -4; dy <= 4; dy += 2) {
          for (let dx = -4; dx <= 4; dx += 2) {
            if (green(x + dx, y + dy)) density += 1;
          }
        }
        if (!best || density > best.density) best = { x, y, density };
      }
    }
    if (!best || best.density < 6) return null;
    return { x: best.x / scratch.width, y: best.y / scratch.height, density: best.density };
  }, dataUrl);
  if (!relative) return null;
  return {
    x: box.x + relative.x * box.width,
    y: box.y + relative.y * box.height,
    density: relative.density,
  };
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test("published _site mounts standalone renderer with visible RGB and END arrows", async ({ page }, testInfo) => {
  await loadAset(page, kernelAset());
  await enter3d(page);

  const contract = await sharedThreeContract(page);
  expect(contract).toEqual({
    colors: { startOuter: 0xff0000, center: 0x00ff00, endOuter: 0x0000ff },
    hasLiveRenderer: true,
    hasPresentation: true,
    hasPause: true,
  });

  const snapshot = await sharedRendererSnapshot(page);
  expect(snapshot?.mounted).toBe(true);
  expect(snapshot?.nodeCount).toBe(5);
  expect(snapshot?.arcCount).toBe(10);
  expect(snapshot?.arrowCount).toBeGreaterThan(0);
  expect(snapshot?.width).toBeGreaterThan(0);
  expect(snapshot?.height).toBeGreaterThan(0);

  const canvas = page.locator("#graph > canvas");
  const screenshot = await canvas.screenshot();
  const counts = await semanticPixelCounts(page, screenshot);
  expect(counts.start).toBeGreaterThan(0);
  expect(counts.center).toBeGreaterThan(10);
  expect(counts.end).toBeGreaterThan(0);
  await testInfo.attach("shared-3d-semantic-rgb.png", { body: screenshot, contentType: "image/png" });
});

test("desktop page wires exact VisualKey activation and root drag without click alias", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await loadAset(page, rootOnlyAset());
  await enter3d(page);
  await page.locator("#graphPhysicsPause").click();
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");

  let point = await denseGreenNodePoint(page);
  expect(point).not.toBeNull();
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => selectedLink(page)).toBe("R");

  await loadAset(page, rootOnlyAset());
  await enter3d(page);
  await page.locator("#graphPhysicsPause").click();
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");
  expect(await selectedLink(page)).toBeNull();
  point = await denseGreenNodePoint(page);
  expect(point).not.toBeNull();
  const canvas = page.locator("#graph > canvas");
  const beforeDrag = await canvas.screenshot();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y + 45, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  expect(await selectedLink(page)).toBeNull();
  const afterDrag = await canvas.screenshot();
  expect(afterDrag.equals(beforeDrag)).toBe(false);
  await testInfo.attach("shared-root-drag.png", { body: afterDrag, contentType: "image/png" });
});

test("shared live controls, fit, zoom and fullscreen remain operational", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await loadAset(page, branchedAset());
  await enter3d(page);
  const canvas = page.locator("#graph > canvas");

  await page.locator("#graphPhysicsPause").click();
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");
  const paused = await canvas.screenshot();
  await page.locator("#graphCharge").fill("2.2");
  await page.locator("#graphSpringStiffness").fill("0.11");
  await page.locator("#graphDamping").fill("0.72");
  await expect(page.locator("#graphChargeValue")).toHaveText("2.20");
  await expect(page.locator("#graphSpringStiffnessValue")).toHaveText("0.110");
  await expect(page.locator("#graphDampingValue")).toHaveText("0.72");

  await page.locator("#graphPhysicsPause").click();
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Пауза");
  await page.waitForTimeout(300);
  const moving = await canvas.screenshot();
  expect(moving.equals(paused)).toBe(false);

  await page.locator("#graphPhysicsPause").click();
  await page.locator("#graphFit").click();
  await page.waitForTimeout(80);
  const fitted = await canvas.screenshot();
  await page.locator("#graphZoomIn").click();
  await page.waitForTimeout(80);
  const zoomed = await canvas.screenshot();
  expect(zoomed.equals(fitted)).toBe(false);

  await page.locator("#graphFullscreen").click();
  await expect(page.locator("#graphFullscreen")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
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
  const afterFirst = await sharedRendererSnapshot(page);
  expect(afterFirst?.nodeCount).toBe(before?.nodeCount);
  expect(afterFirst?.arcCount).toBe(before?.arcCount);
  await page.locator("#debugNext").click();
  await expect(page.locator("#debugEffects")).toContainText("видимых связей:");
  expect(await rendererActive(page)).toBe(true);
});

test("repeated 2D/3D switching disposes and recreates only shared renderer state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await loadAset(page, branchedAset());

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await enter3d(page);
    expect(await rendererActive(page)).toBe(true);
    await expect(page.locator("#graph > canvas")).toHaveCount(1);

    await page.selectOption("#graphView", "2d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
    expect(await rendererActive(page)).toBe(false);
    await expect(page.locator("#graph > canvas")).toHaveCount(0);
  }
});

test("browser corpus covers branched, recursive SCC and dense 25-link asets", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  for (const aset of [branchedAset(), recursiveAset(), chainAset(25)]) {
    await loadAset(page, aset);
    await enter3d(page);
    const snapshot = await sharedRendererSnapshot(page);
    expect(snapshot?.nodeCount).toBe(aset.links.length);
    expect(snapshot?.arcCount).toBe(aset.links.length * 2);
    expect(snapshot?.arrowCount).toBeGreaterThan(0);
    await page.selectOption("#graphView", "2d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
  }
});

test("touch viewport initializes shared 3D and activates exact root VisualKey", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-touch");
  await loadAset(page, rootOnlyAset());
  await enter3d(page);
  await page.locator("#graphPhysicsPause").click();
  const canvas = page.locator("#graph > canvas");
  await expect(canvas).toHaveCSS("touch-action", "none");
  const point = await denseGreenNodePoint(page);
  expect(point).not.toBeNull();
  await page.touchscreen.tap(point.x, point.y);
  await expect.poll(() => selectedLink(page)).toBe("R");
  const viewport = page.viewportSize();
  expect(viewport?.width).toBeLessThan(500);
  expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
  expect(await page.evaluate(() => navigator.userAgent.includes("Mobile"))).toBe(true);
});

test("WebGL failure falls back to a usable structural 2D view", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-webgl", "--disable-webgl2", "--disable-gpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(BASE_URL);
    await expect(page.locator("#status")).toContainText("Готово");
    await page.selectOption("#graphView", "3d");
    await expect(page.locator("#graphView")).toHaveValue("2d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
    await expect(page.locator("#status")).toContainText("3D недоступен");
    await expect(page.locator("#status")).toContainText("структурный 2D");
    await expect(page.locator("#graphLayout")).toBeEnabled();
    await page.locator("#graphFit").click();
  } finally {
    await browser.close();
  }
});

test("N=300 published scene remains finite through public shared snapshot", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  test.setTimeout(120_000);
  const aset = chainAset(300);
  await loadAset(page, aset);
  await enter3d(page);
  const snapshot = await sharedRendererSnapshot(page);
  expect(snapshot?.nodeCount).toBe(300);
  expect(snapshot?.arcCount).toBe(600);
  expect(snapshot?.arrowCount).toBeGreaterThan(0);
  expect(Number.isFinite(snapshot?.cameraPosition.x)).toBe(true);
  expect(Number.isFinite(snapshot?.cameraPosition.y)).toBe(true);
  expect(Number.isFinite(snapshot?.cameraPosition.z)).toBe(true);
});
