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
    provenance: { status: "browser-live-drag-fixture" },
  };
}

async function boot3d(page) {
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("Готово");
  await page.selectOption("#inputFormat", "aset");
  await page.locator("#source").fill(JSON.stringify(kernelAset()));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("Готово");
  await page.selectOption("#graphView", "3d");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "3d");
  await expect(page.locator("#graph > canvas")).toHaveCount(1);
  await page.locator("#graphPhysicsPause").click();
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");
  await page.locator("#graphFit").click();
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
  const png = await canvas.screenshot();
  const box = await canvas.boundingBox();
  if (!box) return null;
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
    if (count < 4 || maxX < minX || maxY < minY) return null;
    return {
      x: ((minX + maxX) / 2) / scratch.width,
      y: ((minY + maxY) / 2) / scratch.height,
    };
  }, dataUrl);
  return relative ? { x: box.x + relative.x * box.width, y: box.y + relative.y * box.height } : null;
}

async function activateExactKey(page, key) {
  const point = await publicHaloPoint(page, key);
  expect(point, `public presentation halo for ${key}`).not.toBeNull();
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("#graph")).toHaveAttribute("data-selected-link", key);
  return point;
}

async function proveDragWithoutClick(page, key, sentinelKey, point) {
  await activateExactKey(page, sentinelKey);
  await expect(page.locator("#graph")).toHaveAttribute("data-selected-link", sentinelKey);

  const canvas = page.locator("#graph > canvas");
  const before = await canvas.screenshot();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 85, point.y + 38, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  await expect(page.locator("#graph")).toHaveAttribute("data-selected-link", sentinelKey);
  expect((await canvas.screenshot()).equals(before), `${key} drag must move the shared scene`).toBe(false);
}

test("desktop shared canvas activates exact VisualKey and drag suppresses click", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await boot3d(page);
  const point = await activateExactKey(page, "L");
  await proveDragWithoutClick(page, "L", "R", point);
});

test("root is an ordinary draggable shared-physics Link", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await boot3d(page);
  const point = await activateExactKey(page, "R");
  await proveDragWithoutClick(page, "R", "L", point);
});
