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
}

async function resetFixture(page) {
  await page.selectOption("#graphView", "2d");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("Готово");
  await page.selectOption("#graphView", "3d");
  await expect(page.locator("#graph > canvas")).toHaveCount(1);
  if (await page.locator("#graphPhysicsPause").textContent() === "Пауза") {
    await page.locator("#graphPhysicsPause").click();
  }
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");
  await expect(page.locator("#graph")).not.toHaveAttribute("data-selected-link", /.+/);
}

async function greenCenterCandidates(page) {
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
    const green = (x, y) => {
      if (x < 0 || y < 0 || x >= scratch.width || y >= scratch.height) return false;
      const offset = (y * scratch.width + x) * 4;
      return data[offset] < 80 && data[offset + 1] > 180 && data[offset + 2] < 80;
    };
    const scored = [];
    for (let y = 5; y < scratch.height - 5; y += 3) {
      for (let x = 5; x < scratch.width - 5; x += 3) {
        if (!green(x, y)) continue;
        let density = 0;
        for (let dy = -5; dy <= 5; dy += 2) {
          for (let dx = -5; dx <= 5; dx += 2) if (green(x + dx, y + dy)) density += 1;
        }
        if (density >= 10) scored.push({ x, y, density });
      }
    }
    scored.sort((a, b) => b.density - a.density);
    const chosen = [];
    for (const candidate of scored) {
      if (chosen.every((point) => Math.hypot(point.x - candidate.x, point.y - candidate.y) > 18)) {
        chosen.push(candidate);
      }
      if (chosen.length >= 12) break;
    }
    return chosen.map((point) => ({ x: point.x / scratch.width, y: point.y / scratch.height }));
  }, dataUrl);
  return relative.map((point) => ({ x: box.x + point.x * box.width, y: box.y + point.y * box.height }));
}

async function findPointForKey(page, key) {
  for (const point of await greenCenterCandidates(page)) {
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(30);
    if (await page.locator("#graph").getAttribute("data-selected-link") === key) return point;
  }
  return null;
}

async function proveDragWithoutClick(page, key) {
  const point = await findPointForKey(page, key);
  expect(point, `visible center for ${key}`).not.toBeNull();
  await resetFixture(page);
  const canvas = page.locator("#graph > canvas");
  const before = await canvas.screenshot();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 85, point.y + 38, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  expect(await page.locator("#graph").getAttribute("data-selected-link")).toBeNull();
  expect((await canvas.screenshot()).equals(before)).toBe(false);
}

test("desktop shared canvas activates exact VisualKey and drag suppresses click", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await boot3d(page);
  const point = await findPointForKey(page, "L");
  expect(point).not.toBeNull();
  await expect(page.locator("#graph")).toHaveAttribute("data-selected-link", "L");
  await proveDragWithoutClick(page, "L");
});

test("root is an ordinary draggable shared-physics Link", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await boot3d(page);
  const point = await findPointForKey(page, "R");
  expect(point).not.toBeNull();
  await expect(page.locator("#graph")).toHaveAttribute("data-selected-link", "R");
  await proveDragWithoutClick(page, "R");
});
