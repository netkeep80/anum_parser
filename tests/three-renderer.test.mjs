import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { dotVec3, normalizeVec3 } from "../src/geometry3d.js";
import { buildPhysicalModel3d } from "../src/physics3d.js";
import { buildThreeSceneData } from "../src/three-renderer.js";
import { SEMANTIC_COLORS, buildVisualModel } from "../src/visual-model.js";

function fixture() {
  return {
    root: "X",
    links: [
      { id: "X", start: "A", end: "B" },
      { id: "A", start: "A", end: "A" },
      { id: "B", start: "B", end: "B" },
    ],
  };
}

function physicalState(visualModel) {
  return {
    physicalModel: buildPhysicalModel3d(visualModel),
    positions: {
      X: { x: 0, y: 0, z: 0 },
      A: { x: -2, y: 1, z: 1 },
      B: { x: 2, y: -1, z: 0.5 },
    },
  };
}

function arc(data, id) {
  const found = data.arcs.find((item) => item.id === id);
  assert.ok(found, `arc ${id} must be rendered`);
  return found;
}

test("Three scene data детерминирован и не мутирует shared inputs", () => {
  const visual = buildVisualModel(fixture());
  const physical = physicalState(visual);
  const visualBefore = structuredClone(visual);
  const physicalBefore = structuredClone(physical);

  assert.deepEqual(
    buildThreeSceneData(visual, physical),
    buildThreeSceneData(visual, physical),
  );
  assert.deepEqual(visual, visualBefore);
  assert.deepEqual(physical, physicalBefore);
});

test("каждый link center становится GREEN node, root остаётся GREEN и крупнее", () => {
  const visual = buildVisualModel(fixture());
  const data = buildThreeSceneData(visual, physicalState(visual));

  assert.equal(data.nodes.length, visual.nodes.length);
  assert.ok(data.nodes.every((node) => node.color === SEMANTIC_COLORS.center));
  const root = data.nodes.find((node) => node.id === "X");
  const ordinary = data.nodes.find((node) => node.id === "A");
  assert.ok(root.root);
  assert.deepEqual(root.position, { x: 0, y: 0, z: 0 });
  assert.equal(root.color, ordinary.color);
  assert.ok(root.radius > ordinary.radius);
});

test("start spring остаётся RED -> GREEN, end spring GREEN -> BLUE + arrow", () => {
  const visual = buildVisualModel(fixture());
  const data = buildThreeSceneData(visual, physicalState(visual), {
    coilRadius: 0.06,
    pitch: 0.25,
  });
  const start = arc(data, "pole-start:X");
  const end = arc(data, "pole-end:X");

  assert.deepEqual(
    [start.colorFrom, start.colorTo, start.arrow],
    [SEMANTIC_COLORS.start, SEMANTIC_COLORS.center, "none"],
  );
  assert.deepEqual(
    [end.colorFrom, end.colorTo, end.arrow],
    [SEMANTIC_COLORS.center, SEMANTIC_COLORS.end, "target"],
  );
  assert.ok(start.points.length > 8);
  assert.ok(end.points.length > 8);
});

test("visible spring использует S2 centerline endpoints и true-3D GREEN 180°", () => {
  const visual = buildVisualModel(fixture());
  const physical = physicalState(visual);
  const data = buildThreeSceneData(visual, physical, { coilRadius: 0.08 });
  const start = arc(data, "pole-start:X");
  const end = arc(data, "pole-end:X");

  assert.deepEqual(start.points[0], physical.positions.A);
  assert.deepEqual(start.points.at(-1), physical.positions.X);
  assert.deepEqual(end.points[0], physical.positions.X);
  assert.deepEqual(end.points.at(-1), physical.positions.B);

  const startOut = normalizeVec3(start.greenOutwardTangent);
  const endOut = normalizeVec3(end.greenOutwardTangent);
  assert.ok(startOut && endOut);
  assert.ok(Math.abs(dotVec3(startOut, endOut) + 1) < 1e-12);
});

test("visual semantic arc topology и force spring topology совпадают по arcId", () => {
  const visual = buildVisualModel(fixture());
  const physical = physicalState(visual);
  const data = buildThreeSceneData(visual, physical);
  const forceIds = new Set(data.forceSpringArcIds);

  for (const item of data.arcs) {
    if (item.self) {
      assert.equal(item.forceSpring, false);
      assert.ok(!forceIds.has(item.arcId));
    } else {
      assert.equal(item.forceSpring, true);
      assert.ok(forceIds.has(item.arcId));
    }
  }
  assert.deepEqual(
    [...forceIds].sort(),
    data.arcs.filter((item) => !item.self).map((item) => item.arcId).sort(),
  );
});

test("self-loop остаётся видимым spring geometry без self-force", () => {
  const visual = buildVisualModel(fixture());
  const data = buildThreeSceneData(visual, physicalState(visual));
  const startSelf = arc(data, "pole-start:A");
  const endSelf = arc(data, "pole-end:A");

  assert.equal(startSelf.self, true);
  assert.equal(endSelf.self, true);
  assert.equal(startSelf.forceSpring, false);
  assert.equal(endSelf.forceSpring, false);
  assert.ok(startSelf.points.length > 8);
  assert.ok(endSelf.points.length > 8);
  assert.deepEqual(startSelf.points[0], startSelf.points.at(-1));
  assert.deepEqual(endSelf.points[0], endSelf.points.at(-1));
});

test("BLUE arrow direction берётся из semantic endpoint tangent, не из coil phase", () => {
  const visual = buildVisualModel(fixture());
  const physical = physicalState(visual);
  const lowTurns = buildThreeSceneData(visual, physical, { pitch: 2, coilRadius: 0.12 });
  const highTurns = buildThreeSceneData(visual, physical, { pitch: 0.12, coilRadius: 0.12 });

  assert.deepEqual(
    arc(lowTurns, "pole-end:X").endTangent,
    arc(highTurns, "pole-end:X").endTangent,
  );
});

test("Three renderer зависит от local package boundary, но не читает MTS/Aset format", async () => {
  const source = await readFile(new URL("../src/three-renderer.js", import.meta.url), "utf8");

  assert.match(source, /from "three"/);
  assert.match(source, /semanticLinkGeometry3d/);
  assert.match(source, /springCurveAroundCenterline3d/);
  assert.doesNotMatch(source, /@mts\/core/i);
  assert.doesNotMatch(source, /parseArtifact|\.aset\.json/i);
  assert.doesNotMatch(source, /https?:\/\//i);
});

test("UI сохраняет 2D default, а production 3D lifecycle делегирует standalone @mts/visual", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="graphView"/);
  assert.match(html, /<option value="2d" selected>2D — структурная карта<\/option>/);
  assert.match(html, /<option value="blueprint">2D — blueprint связей<\/option>/);
  assert.match(html, /<option value="3d">3D — механическая асеть<\/option>/);
  assert.match(app, /graphView:\s*"2d"/);
  assert.match(app, /state\.visualModel = buildVisualModel\(aset\)/);
  assert.match(app, /state\.visualNetwork = projectAsetToVisualLinkNetwork\(aset\)/);
  assert.match(app, /createBlueprintRenderer\(ui\.graph, state\.visualModel,/);
  assert.match(app, /destroyBlueprintRenderer\(ui\.graph\)/);
  assert.match(app, /fitBlueprintRenderer\(ui\.graph\)/);
  assert.match(app, /zoomBlueprintRenderer\(ui\.graph, factor\)/);
  assert.match(app, /solveReadableLayout3d\(state\.visualModel\)/);
  assert.match(app, /createLivePhysics3D\(/);
  assert.match(
    app,
    /createVisualThreeLiveRenderer\(ui\.graph, state\.visualNetwork, controller,\s*\{/,
  );
  assert.match(app, /onActivateKey:\s*\(key\) =>/);
  assert.match(app, /setVisualThreePresentation\(/);
  assert.match(app, /destroyVisualThreeRenderer\(ui\.graph\)/);
  assert.doesNotMatch(app, /create3dRenderer\(|destroy3dRenderer\(|set3dDebugState\(/);
  assert.match(app, /renderAset\(ui\.graph, aset,/);
  assert.match(app, /const is2d = state\.graphView === "2d"/);
  assert.match(app, /ui\.graphLayout\.disabled = !is2d/);
  assert.match(app, /ui\.graphPhysicsControls\.hidden = !is3d/);
});

test("browser Three import map остаётся exact-local и не использует remote Three CDN", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /"three":\s*"\.\/vendor\/three\/three\.module\.js"/);
  assert.match(html, /"three\/addons\/":\s*"\.\/vendor\/three\/addons\/"/);
  assert.doesNotMatch(html, /https?:\/\/[^"'\s]*three/i);
});
