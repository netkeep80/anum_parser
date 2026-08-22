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
}

async function liveSnapshot(page) {
  return page.evaluate(async () => {
    const module = await import("./src/three-renderer.js");
    return module.get3dLivePhysicsSnapshot(document.getElementById("graph"));
  });
}

async function selectLink(page, linkId) {
  await page.evaluate(async (id) => {
    const module = await import("./src/three-renderer.js");
    module.set3dSelectedLink(document.getElementById("graph"), id);
  }, linkId);
  await expect(page.locator(`[data-role="three-label-layer"] [data-link-id="${linkId}"]`)).toBeVisible();
}

async function linkScreenPoint(page, linkId) {
  const canvas = page.locator("#graph > canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const point = await page.evaluate((id) => {
    const graph = document.getElementById("graph");
    const label = graph.querySelector(`[data-role="three-label-layer"] [data-link-id="${id}"]`);
    if (!graph || !label) return null;
    return {
      x: Number.parseFloat(label.style.left),
      y: Number.parseFloat(label.style.top),
    };
  }, linkId);
  if (!box || !point) return null;
  return { x: box.x + point.x, y: box.y + point.y };
}

function moved(before, after, id, epsilon = 1e-4) {
  const left = before.positions[id];
  const right = after.positions[id];
  if (!left || !right) return false;
  return Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z) > epsilon;
}

test("desktop drag pins a free link center and propagates motion through the live aset", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await boot3d(page);

  await selectLink(page, "L");
  const before = await liveSnapshot(page);
  const point = await linkScreenPoint(page, "L");
  expect(point).not.toBeNull();

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 90, point.y + 35, { steps: 5 });

  await expect.poll(async () => (await liveSnapshot(page))?.draggingLinkId).toBe("L");
  const during = await liveSnapshot(page);
  expect(during.pinnedNodeIds).toContain("L");
  expect(moved(before, during, "L", 0.02)).toBe(true);
  expect(during.positions.R).toEqual({ x: 0, y: 0, z: 0 });

  await expect.poll(async () => {
    const current = await liveSnapshot(page);
    return ["O", "C", "U"].some((id) => moved(before, current, id, 1e-6));
  }).toBe(true);

  await page.mouse.up();
  await expect.poll(async () => (await liveSnapshot(page))?.draggingLinkId).toBeNull();
  await expect.poll(async () => (await liveSnapshot(page))?.pinnedNodeIds.includes("L")).toBe(false);

  const released = await liveSnapshot(page);
  expect(released.tick).toBeGreaterThan(before.tick);
  expect(released.positions.R).toEqual({ x: 0, y: 0, z: 0 });
  await expect.poll(async () => (await liveSnapshot(page))?.tick).toBeGreaterThan(released.tick);
});

test("root remains selectable but cannot enter drag/pin state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");
  await boot3d(page);
  await selectLink(page, "R");
  const point = await linkScreenPoint(page, "R");
  expect(point).not.toBeNull();

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y + 30, { steps: 4 });
  const during = await liveSnapshot(page);
  expect(during.draggingLinkId).toBeNull();
  expect(during.pinnedNodeIds).not.toContain("R");
  expect(during.positions.R).toEqual({ x: 0, y: 0, z: 0 });
  await page.mouse.up();
});
