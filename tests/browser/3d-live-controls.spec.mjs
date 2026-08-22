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
    provenance: { status: "browser-live-controls-fixture" },
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
  await expect(page.locator("#graphPhysicsControls")).toBeVisible();
}

async function liveSnapshot(page) {
  return page.evaluate(async () => {
    const module = await import("./src/three-renderer.js");
    return module.get3dLivePhysicsSnapshot(document.getElementById("graph"));
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

async function inputRange(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

function allZeroVelocities(snapshot) {
  return Object.values(snapshot.velocities).every((velocity) =>
    velocity.x === 0 && velocity.y === 0 && velocity.z === 0);
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test("live physics sliders, pause/resume and reset operate without rebuilding semantic state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await expect(page.locator("#graphPhysicsControls")).toBeHidden();
  await enter3d(page);

  await expect(page.locator("#graphChargeValue")).toHaveText("1.00");
  await expect(page.locator("#graphSpringStiffnessValue")).toHaveText("0.055");
  await expect(page.locator("#graphDampingValue")).toHaveText("0.86");

  const initial = await liveSnapshot(page);
  expect(initial.options.charge).toBe(1);
  expect(initial.options.springStiffness).toBe(0.055);
  expect(initial.options.damping).toBe(0.86);

  await setSelectedLink(page, "L");
  await expect.poll(() => selectedLink(page)).toBe("L");

  await page.locator("#graphPhysicsPause").click();
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Продолжить");
  const paused = await liveSnapshot(page);
  expect(paused.paused).toBe(true);
  const pausedTick = paused.tick;
  await page.waitForTimeout(180);
  expect((await liveSnapshot(page)).tick).toBe(pausedTick);

  await inputRange(page, "#graphCharge", 1.75);
  await inputRange(page, "#graphSpringStiffness", 0.12);
  await inputRange(page, "#graphDamping", 0.72);
  await expect(page.locator("#graphChargeValue")).toHaveText("1.75");
  await expect(page.locator("#graphSpringStiffnessValue")).toHaveText("0.120");
  await expect(page.locator("#graphDampingValue")).toHaveText("0.72");

  const changed = await liveSnapshot(page);
  expect(changed.options.charge).toBe(1.75);
  expect(changed.options.springStiffness).toBe(0.12);
  expect(changed.options.damping).toBe(0.72);
  expect(changed.awake).toBe(true);
  expect(changed.paused).toBe(true);
  expect(changed.tick).toBe(pausedTick);

  await page.locator("#graphPhysicsPause").click();
  await expect(page.locator("#graphPhysicsPause")).toHaveText("Пауза");
  await expect.poll(async () => (await liveSnapshot(page)).tick).toBeGreaterThan(pausedTick);

  await page.locator("#graphPhysicsPause").click();
  const beforeResetTick = (await liveSnapshot(page)).tick;
  await page.waitForTimeout(120);
  expect((await liveSnapshot(page)).tick).toBe(beforeResetTick);

  await page.locator("#graphPhysicsReset").click();
  const firstReset = await liveSnapshot(page);
  expect(firstReset.tick).toBe(0);
  expect(firstReset.paused).toBe(true);
  expect(allZeroVelocities(firstReset)).toBe(true);
  expect(await selectedLink(page)).toBe("L");

  await page.locator("#graphPhysicsPause").click();
  await expect.poll(async () => (await liveSnapshot(page)).tick).toBeGreaterThan(0);
  await page.locator("#graphPhysicsPause").click();
  await page.locator("#graphPhysicsReset").click();
  const secondReset = await liveSnapshot(page);

  expect(secondReset.tick).toBe(0);
  expect(secondReset.positions).toEqual(firstReset.positions);
  expect(allZeroVelocities(secondReset)).toBe(true);
  expect(secondReset.options.charge).toBe(1.75);
  expect(secondReset.options.springStiffness).toBe(0.12);
  expect(secondReset.options.damping).toBe(0.72);
  expect(await selectedLink(page)).toBe("L");
});