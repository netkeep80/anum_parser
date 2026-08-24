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
    provenance: { status: "browser-blueprint-fidelity-fixture" },
  };
}

async function bootKernel(page) {
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

async function centerScreenPoint(page, linkId) {
  const center = page.locator(`[data-role="blueprint-center"][data-link-id="${linkId}"]`);
  const box = await center.boundingBox();
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function renderedLinkEvidence(page) {
  return page.locator('[data-role="blueprint-link"]').evaluateAll((groups) => groups.map((group) => {
    const path = group.querySelector('[data-role="blueprint-link-path"]');
    const markerId = (value) => /^url\(#(.+)\)$/.exec(value ?? "")?.[1] ?? null;
    const startMarker = document.getElementById(markerId(path?.getAttribute("marker-start")) ?? "");
    const endMarker = document.getElementById(markerId(path?.getAttribute("marker-end")) ?? "");
    const color = path?.getAttribute("stroke") ?? null;
    const d = path?.getAttribute("d") ?? "";
    return {
      id: group.getAttribute("data-link-id"),
      color,
      d,
      moveCount: (d.match(/\bM\b/g) ?? []).length,
      cubicCount: (d.match(/\bC\b/g) ?? []).length,
      length: path?.getTotalLength() ?? 0,
      startMarkerColor: startMarker?.getAttribute("data-link-color") ?? null,
      startLineColors: [...(startMarker?.querySelectorAll("line") ?? [])].map((line) => line.getAttribute("stroke")),
      startLineCount: startMarker?.querySelectorAll("line").length ?? 0,
      endMarkerColor: endMarker?.getAttribute("data-link-color") ?? null,
      endLineColors: [...(endMarker?.querySelectorAll("line") ?? [])].map((line) => line.getAttribute("stroke")),
      endLineCount: endMarker?.querySelectorAll("line").length ?? 0,
    };
  }));
}

async function geometryEvidence(page) {
  return page.evaluate(async () => {
    const [visual, rendererModule, adapterModule] = await Promise.all([
      import("./generated/mts-visual/index.js"),
      import("./src/blueprint-renderer.js"),
      import("./src/mts-visual-adapter.js"),
    ]);
    const graph = document.getElementById("graph");
    const snapshot = rendererModule.getBlueprintRendererSnapshot(graph);
    const aset = JSON.parse(document.getElementById("asetJson").textContent);
    const network = adapterModule.projectAsetToVisualLinkNetwork(aset);
    const positions = Object.entries(snapshot.positions).map(([key, point]) => ({ key, point }));
    const geometry = visual.buildBlueprintGeometry(network, positions);
    const positionByKey = Object.fromEntries(geometry.positions.map(({ key, point }) => [key, point]));
    const epsilon = 1e-7;
    const near = (left, right) => Boolean(left && right) &&
      Math.hypot(left.x - right.x, left.y - right.y) <= epsilon * Math.max(
        1,
        Math.hypot(left.x, left.y),
        Math.hypot(right.x, right.y),
      );

    return {
      finite: visual.blueprintGeometryIsFinite(geometry),
      links: geometry.links.map((link) => {
        const joints = [];
        for (let index = 0; index < link.segments.length - 1; index += 1) {
          const left = link.segments[index];
          const right = link.segments[index + 1];
          joints.push({
            pointContinuous: near(left.p3, right.p0),
            derivativeContinuous: near(
              visual.blueprintCubicDerivativeAtEnd(left),
              visual.blueprintCubicDerivativeAtStart(right),
            ),
          });
        }
        const centerOnPath = link.segments.some((segment) =>
          near(segment.p0, link.center) || near(segment.p3, link.center));
        const nonDegenerate = link.segments.some((segment) =>
          [segment.p0, segment.p1, segment.p2, segment.p3]
            .some((point) => Math.hypot(point.x - link.center.x, point.y - link.center.y) > epsilon));
        return {
          id: link.key,
          segmentCount: link.segments.length,
          c1: visual.blueprintSegmentsAreC1(link.segments, epsilon),
          allJointPointsContinuous: joints.every((joint) => joint.pointContinuous),
          allJointDerivativesContinuous: joints.every((joint) => joint.derivativeContinuous),
          centerOnPath,
          startPinned: near(link.startAnchor, positionByKey[link.startKey]),
          endPinned: near(link.endAnchor, positionByKey[link.endKey]),
          selfStart: link.startKey === link.key,
          selfEnd: link.endKey === link.key,
          nonDegenerate,
        };
      }),
    };
  });
}

test.beforeEach(async ({ page }) => {
  await bootKernel(page);
});

test("one semantic link is one colored C1 SVG path with faithful endpoint markers", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  await expect(page.locator('#graphView option[value="2d"]')).toHaveCount(1);
  await expect(page.locator('#graphView option[value="blueprint"]')).toHaveCount(1);
  await expect(page.locator('#graphView option[value="3d"]')).toHaveCount(1);
  const semanticBefore = await page.locator("#asetJson").textContent();
  await enterBlueprint(page);

  await expect(page.locator('[data-role="blueprint-link"]')).toHaveCount(5);
  await expect(page.locator('[data-role="blueprint-link-path"]')).toHaveCount(5);
  await expect(page.locator("#graph defs linearGradient")).toHaveCount(0);

  const rendered = await renderedLinkEvidence(page);
  const geometry = await geometryEvidence(page);
  const geometryById = new Map(geometry.links.map((link) => [link.id, link]));
  expect(rendered).toHaveLength(5);
  expect(new Set(rendered.map((link) => link.color)).size).toBe(5);
  for (const link of rendered) {
    const shared = geometryById.get(link.id);
    expect(shared).toBeTruthy();
    expect(link.color).toBeTruthy();
    expect(link.d).toMatch(/^M /);
    expect(link.moveCount).toBe(1);
    expect(link.cubicCount).toBe(shared.segmentCount);
    expect(link.cubicCount).toBeGreaterThan(0);
    expect(link.startMarkerColor).toBe(link.color);
    expect(link.startLineCount).toBe(1);
    expect(link.startLineColors).toEqual([link.color]);
    expect(link.endMarkerColor).toBe(link.color);
    expect(link.endLineCount).toBe(2);
    expect(link.endLineColors).toEqual([link.color, link.color]);
  }

  const root = rendered.find((link) => link.id === "R");
  expect(root).toBeTruthy();
  expect(Number.isFinite(root.length)).toBe(true);
  expect(root.length).toBeGreaterThan(1);

  expect(geometry.finite).toBe(true);
  expect(geometry.links).toHaveLength(5);
  for (const link of geometry.links) {
    expect(link.segmentCount).toBeGreaterThan(0);
    expect(link.c1).toBe(true);
    expect(link.allJointPointsContinuous).toBe(true);
    expect(link.allJointDerivativesContinuous).toBe(true);
    expect(link.centerOnPath).toBe(true);
    expect(link.startPinned).toBe(true);
    expect(link.endPinned).toBe(true);
    expect(link.nonDegenerate).toBe(true);
  }
  const rootGeometry = geometry.links.find((link) => link.id === "R");
  expect(rootGeometry).toMatchObject({ selfStart: true, selfEnd: true, c1: true, centerOnPath: true });
  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
});

test("drag and view re-entry preserve pinning C1 color identity and semantic Aset", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop");

  const semanticBefore = await page.locator("#asetJson").textContent();
  await enterBlueprint(page);
  const renderedBefore = await renderedLinkEvidence(page);
  const colorsBefore = Object.fromEntries(renderedBefore.map((link) => [link.id, link.color]));
  const pathsBefore = Object.fromEntries(renderedBefore.map((link) => [link.id, link.d]));
  const point = await centerScreenPoint(page, "O");
  expect(point).not.toBeNull();

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 90, point.y + 45, { steps: 5 });
  await page.mouse.up();

  const afterDrag = await geometryEvidence(page);
  expect(afterDrag.finite).toBe(true);
  for (const link of afterDrag.links) {
    expect(link.c1).toBe(true);
    expect(link.centerOnPath).toBe(true);
    expect(link.startPinned).toBe(true);
    expect(link.endPinned).toBe(true);
    expect(link.nonDegenerate).toBe(true);
  }
  expect(await geometryEvidence(page)).toEqual(afterDrag);
  const renderedAfter = await renderedLinkEvidence(page);
  const pathsAfter = Object.fromEntries(renderedAfter.map((link) => [link.id, link.d]));
  expect(pathsAfter.L).not.toBe(pathsBefore.L);
  expect(pathsAfter.U).not.toBe(pathsBefore.U);
  expect(Object.fromEntries(renderedAfter.map((link) => [link.id, link.color]))).toEqual(colorsBefore);
  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);

  await page.selectOption("#graphView", "2d");
  await expect(page.locator("#graph")).toHaveAttribute("data-view-mode", "2d");
  await enterBlueprint(page);
  await expect(page.locator('[data-role="blueprint-link-path"]')).toHaveCount(5);
  expect(Object.fromEntries((await renderedLinkEvidence(page)).map((link) => [link.id, link.color]))).toEqual(colorsBefore);
  const afterReentry = await geometryEvidence(page);
  expect(afterReentry.links.every((link) =>
    link.c1 && link.centerOnPath && link.startPinned && link.endPinned && link.nonDegenerate)).toBe(true);
  expect(await page.locator("#asetJson").textContent()).toBe(semanticBefore);
});
