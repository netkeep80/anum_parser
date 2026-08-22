import { chromium, expect, test } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173";
const COLORS = Object.freeze({
  start: "#ff657a",
  center: "#67e8b3",
  end: "#73a7ff",
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

async function enter3d(page) {
  await page.selectOption("#graphView", "3d");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "3d");
  await expect(page.locator("#graph > canvas")).toHaveCount(1);
  await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(1);
}

async function rendererSnapshot(page) {
  return page.evaluate(async () => {
    const module = await import("./src/three-renderer.js");
    return module.get3dPerformanceSnapshot(document.getElementById("graph"));
  });
}

async function selectedLink(page) {
  return page.evaluate(async () => {
    const module = await import("./src/three-renderer.js");
    return module.get3dSelectedLink(document.getElementById("graph"));
  });
}

async function rendererActive(page) {
  return page.evaluate(async () => {
    const module = await import("./src/three-renderer.js");
    return module.has3dRenderer(document.getElementById("graph"));
  });
}

async function rootScreenPoint(page) {
  return page.evaluate(() => {
    const graph = document.getElementById("graph");
    const canvas = graph.querySelector(":scope > canvas");
    const label = graph.querySelector('[data-role="three-label-layer"] [data-link-id="R"]');
    if (!canvas || !label) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + Number.parseFloat(label.style.left),
      y: rect.top + Number.parseFloat(label.style.top),
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
        ) <= 65) counts[key] += 1;
      }
    }
    return counts;
  }, { dataUrl, colors: COLORS });
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test("published _site renders semantic RGB and all ordinary/self-loop classes", async ({ page }, testInfo) => {
  await loadAset(page, kernelAset());
  await enter3d(page);

  const snapshot = await rendererSnapshot(page);
  expect(snapshot).not.toBeNull();
  expect(snapshot.performanceBudget.withinBudget).toBe(true);
  expect(snapshot.lodPlan.nodes).toHaveLength(5);
  expect(snapshot.lodPlan.nodes.every((node) => node.semanticColor === COLORS.center)).toBe(true);

  const arcs = new Map(snapshot.lodPlan.arcs.map((arc) => [arc.arcId, arc]));
  expect(arcs.get("pole-start:R")?.self).toBe(true);
  expect(arcs.get("pole-end:R")?.self).toBe(true);
  expect(arcs.get("pole-start:O")?.self).toBe(true);
  expect(arcs.get("pole-end:C")?.self).toBe(true);
  expect(arcs.get("pole-start:L")?.self).toBe(false);
  expect(arcs.get("pole-end:L")?.self).toBe(false);
  expect(arcs.get("pole-start:L")?.colorFrom).toBe(COLORS.start);
  expect(arcs.get("pole-start:L")?.colorTo).toBe(COLORS.center);
  expect(arcs.get("pole-end:L")?.colorFrom).toBe(COLORS.center);
  expect(arcs.get("pole-end:L")?.colorTo).toBe(COLORS.end);

  const canvas = page.locator("#graph > canvas");
  const screenshot = await canvas.screenshot();
  const counts = await semanticPixelCounts(page, screenshot);
  expect(counts.start).toBeGreaterThan(0);
  expect(counts.center).toBeGreaterThan(10);
  expect(counts.end).toBeGreaterThan(0);
  await testInfo.attach("3d-semantic-rgb.png", { body: screenshot, contentType: "image/png" });

  const rendererSource = await page.evaluate(async () => (await fetch("./src/three-renderer.js")).text());
  expect(rendererSource).toContain('kind: "end-arrow"');
  expect(rendererSource).toContain("new THREE.ConeGeometry");
});

test("desktop camera controls and Raycaster picking remain usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await loadAset(page, kernelAset());
  await enter3d(page);

  const point = await rootScreenPoint(page);
  expect(point).not.toBeNull();
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => selectedLink(page)).toBe("R");

  const canvas = page.locator("#graph > canvas");
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -650);
  await page.waitForTimeout(80);
  const afterZoom = await canvas.screenshot();
  expect(afterZoom.equals(before)).toBe(false);

  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.62, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const afterOrbit = await canvas.screenshot();
  expect(afterOrbit.equals(afterZoom)).toBe(false);
});

test("debugger drives 3D presentation without destroying the renderer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await page.selectOption("#sample", "12");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("Готово");
  await enter3d(page);

  const last = await page.locator("#debugStep").textContent();
  await page.locator("#debugFirst").click();
  await expect(page.locator("#debugStep")).not.toHaveText(last);
  await expect(page.locator("#debugCurrent")).toContainText("операция:");
  expect(await rendererActive(page)).toBe(true);
  await page.locator("#debugNext").click();
  await expect(page.locator("#debugEffects")).toContainText("видимых связей:");
  expect(await rendererActive(page)).toBe(true);
});

test("repeated 2D/3D switching disposes canvases, label layers and renderer state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await loadAset(page, branchedAset());

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await enter3d(page);
    expect(await rendererActive(page)).toBe(true);
    await expect(page.locator("#graph > canvas")).toHaveCount(1);
    await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(1);

    await page.selectOption("#graphView", "2d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
    expect(await rendererActive(page)).toBe(false);
    await expect(page.locator("#graph > canvas")).toHaveCount(0);
    await expect(page.locator('#graph > [data-role="three-label-layer"]')).toHaveCount(0);
  }
});

test("browser corpus covers branched, recursive SCC and dense 25-link asets", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  for (const aset of [branchedAset(), recursiveAset(), chainAset(25)]) {
    await loadAset(page, aset);
    await enter3d(page);
    const snapshot = await rendererSnapshot(page);
    expect(snapshot.performanceBudget.withinBudget).toBe(true);
    expect(snapshot.lodPlan.nodes).toHaveLength(aset.links.length);
    expect(snapshot.lodPlan.arcs).toHaveLength(aset.links.length * 2);
    await page.selectOption("#graphView", "2d");
    await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
  }
});

test("touch viewport initializes 3D and picks exact root link", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-touch");
  await loadAset(page, kernelAset());
  await enter3d(page);
  await expect(page.locator("#graph > canvas")).toHaveCSS("touch-action", "none");
  const point = await rootScreenPoint(page);
  expect(point).not.toBeNull();
  await page.touchscreen.tap(point.x, point.y);
  await expect.poll(() => selectedLink(page)).toBe("R");
  expect((await page.viewportSize()).width).toBe(390);
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

test("N=300 published scene stays inside machine-visible performance budgets", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  test.setTimeout(120_000);
  const aset = chainAset(300);
  await loadAset(page, aset);
  await enter3d(page);
  const snapshot = await rendererSnapshot(page);
  expect(snapshot.performanceBudget.withinBudget).toBe(true);
  expect(snapshot.performanceBudget.observed.visibleLinks).toBe(300);
  expect(snapshot.performanceBudget.observed.semanticArcs).toBe(600);
  expect(snapshot.performanceBudget.observed.arcVertices).toBeLessThanOrEqual(
    snapshot.performanceBudget.limits.maxArcVertices,
  );
  expect(snapshot.performanceBudget.observed.sceneObjects).toBeLessThanOrEqual(
    snapshot.performanceBudget.limits.maxSceneObjects,
  );
  expect(snapshot.performanceBudget.observed.readabilityEvaluations).toBeLessThanOrEqual(
    snapshot.performanceBudget.limits.maxReadabilityEvaluations,
  );
});
