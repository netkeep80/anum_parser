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

async function visualCenterCandidates(page) {
  const canvas = page.locator("#graph > canvas");
  const box = await canvas.boundingBox();
  if (!box) return [];
  const png = await canvas.screenshot();
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
    const greenDominance = (x, y) => {
      if (x < 0 || y < 0 || x >= scratch.width || y >= scratch.height) return 0;
      const offset = (y * scratch.width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const dominance = g - Math.max(r, b);
      return g >= 35 && dominance >= 18 ? dominance : 0;
    };
    const scored = [];
    for (let y = 6; y < scratch.height - 6; y += 3) {
      for (let x = 6; x < scratch.width - 6; x += 3) {
        if (greenDominance(x, y) === 0) continue;
        let score = 0;
        for (let dy = -6; dy <= 6; dy += 3) {
          for (let dx = -6; dx <= 6; dx += 3) score += greenDominance(x + dx, y + dy);
        }
        scored.push({ x, y, score });
      }
    }
    scored.sort((left, right) => right.score - left.score);
    const chosen = [];
    for (const candidate of scored) {
      if (chosen.every((point) => Math.hypot(point.x - candidate.x, point.y - candidate.y) > 8)) {
        chosen.push(candidate);
      }
      if (chosen.length >= 80) break;
    }
    return chosen.map((point) => ({ x: point.x / scratch.width, y: point.y / scratch.height }));
  }, dataUrl);
  return relative.map((point) => ({ x: box.x + point.x * box.width, y: box.y + point.y * box.height }));
}

async function findPointForKey(page, key) {
  const candidates = await visualCenterCandidates(page);
  expect(candidates.length).toBeGreaterThan(0);
  for (const point of candidates) {
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(15);
    if (await page.locator("#graph").getAttribute("data-selected-link") === key) return point;
  }
  return null;
}

async function proveDragWithoutClick(page, key, sentinelKey, point) {
  const sentinelPoint = await findPointForKey(page, sentinelKey);
  expect(sentinelPoint, `visible center for sentinel ${sentinelKey}`).not.toBeNull();
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
  const point = await findPointForKey(page, "L");
  expect(point, "visible center for L").not.toBeNull();
  await expect(page.locator("#graph")).toHaveAttribute("data-selected-link", "L");
  await proveDragWithoutClick(page, "L", "R", point);
});

test("root is an ordinary draggable shared-physics Link", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await boot3d(page);
  const point = await findPointForKey(page, "R");
  expect(point, "visible center for R").not.toBeNull();
  await expect(page.locator("#graph")).toHaveAttribute("data-selected-link", "R");
  await proveDragWithoutClick(page, "R", "L", point);
});
