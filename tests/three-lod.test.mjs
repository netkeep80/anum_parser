import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { solveReadableLayout3d } from "../src/readable-layout3d.js";
import { lodArcSampleIndices3d } from "../src/three-renderer.js";
import { buildVisualModel } from "../src/visual-model.js";

function fixture() {
  return {
    root: "R",
    links: [
      { id: "R", start: "R", end: "R" },
      { id: "A", start: "R", end: "R" },
      { id: "B", start: "A", end: "R" },
    ],
  };
}

test("readable layout композиционно сохраняет deterministic physics и root origin", () => {
  const visual = buildVisualModel(fixture());
  const before = structuredClone(visual);
  const options = {
    physics: {
      maxIterations: 12,
      earlyStopPatience: 3,
    },
    readability: {
      minimumCenterDistance: 0.35,
      maxPasses: 4,
      maxEnergyIncreaseRatio: 0.2,
    },
  };

  const first = solveReadableLayout3d(visual, options);
  const second = solveReadableLayout3d(visual, options);

  assert.deepEqual(first, second);
  assert.deepEqual(visual, before);
  assert.deepEqual(first.positions.R, { x: 0, y: 0, z: 0 });
  assert.equal(first.readability.metrics.rootFixed, true);
  assert.equal(first.readability.metrics.allFinite, true);
  assert.ok(first.readability.metrics.passes <= 4);
  assert.ok(Number.isFinite(first.readability.metrics.initialEnergy));
  assert.ok(Number.isFinite(first.readability.metrics.finalEnergy));
});

test("LOD spring sampling всегда сохраняет оба semantic endpoints", () => {
  const full = lodArcSampleIndices3d(33, 8);
  const mid = lodArcSampleIndices3d(33, 4);
  const far = lodArcSampleIndices3d(33, 2);

  assert.equal(full[0], 0);
  assert.equal(full.at(-1), 32);
  assert.equal(mid[0], 0);
  assert.equal(mid.at(-1), 32);
  assert.equal(far[0], 0);
  assert.equal(far.at(-1), 32);
  assert.ok(full.length > mid.length);
  assert.ok(mid.length > far.length);
  assert.deepEqual(lodArcSampleIndices3d(0, 2), []);
  assert.deepEqual(lodArcSampleIndices3d(1, 2), [0]);
});

test("renderer LOD пересобирает только geometry и не меняет semantic RGB/identity", async () => {
  const source = await readFile(new URL("../src/three-renderer.js", import.meta.url), "utf8");

  assert.match(source, /buildLodPlan3d/);
  assert.match(source, /replaceArcLineGeometry/);
  assert.match(source, /replaceNodeGeometry/);
  assert.match(source, /line\.geometry\.dispose\(\)/);
  assert.match(source, /mesh\.geometry\.dispose\(\)/);
  assert.match(source, /colorFrom:\s*arc\.colorFrom/);
  assert.match(source, /colorTo:\s*arc\.colorTo/);
  assert.match(source, /arcId:\s*arc\.id/);
  assert.match(source, /self:\s*arc\.semanticSource === arc\.semanticTarget/);
});

test("camera movement меняет LOD, но не запускает physical/readability layout", async () => {
  const source = await readFile(new URL("../src/three-renderer.js", import.meta.url), "utf8");
  const start = source.indexOf("function configureControls");
  const end = source.indexOf("function pointerCoordinates", start);
  assert.ok(start >= 0 && end > start);
  const controls = source.slice(start, end);

  assert.match(controls, /applyThreeLodState\(state\)/);
  assert.match(controls, /renderState\(state\)/);
  assert.doesNotMatch(controls, /solvePhysicalLayout3d|solveReadableLayout3d|optimizeReadability3d/);
});

test("debug/selection tier changes не перезапускают world layout", async () => {
  const source = await readFile(new URL("../src/three-renderer.js", import.meta.url), "utf8");
  const start = source.indexOf("function applyThreePresentationState");
  const end = source.indexOf("function configureControls", start);
  assert.ok(start >= 0 && end > start);
  const presentation = source.slice(start, end);

  assert.match(presentation, /applyThreeLodState\(state\)/);
  assert.doesNotMatch(presentation, /solvePhysicalLayout3d|solveReadableLayout3d|optimizeReadability3d/);
});

test("renderer публикует bounded readability/budget snapshot из full scene data", async () => {
  const source = await readFile(new URL("../src/three-renderer.js", import.meta.url), "utf8");

  assert.match(source, /auditReadability3d\(/);
  assert.match(source, /buildPerformanceBudget3d\(/);
  assert.match(source, /export function get3dPerformanceSnapshot/);
  assert.match(source, /renderedArcVertices/);
  assert.match(source, /readabilityAudit/);
  assert.match(source, /performanceBudget/);
});

test("app выполняет readable settle один раз и кэширует physicalState", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(source, /solveReadableLayout3d/);
  assert.match(source, /state\.physicalState \?\?= solveReadableLayout3d\(state\.visualModel\)/);
  assert.doesNotMatch(source, /solvePhysicalLayout3d/);

  const debugStart = source.indexOf("function renderDebugger");
  const debugEnd = source.indexOf("function renderDebugSource", debugStart);
  const debuggerSection = source.slice(debugStart, debugEnd);
  assert.doesNotMatch(debuggerSection, /solveReadableLayout3d|solvePhysicalLayout3d/);
});

test("readable-layout boundary остаётся renderer-independent", async () => {
  const source = await readFile(new URL("../src/readable-layout3d.js", import.meta.url), "utf8");

  assert.match(source, /solvePhysicalLayout3d/);
  assert.match(source, /physicalPotentialEnergy3d/);
  assert.match(source, /optimizeReadability3d/);
  assert.doesNotMatch(source, /from\s+["']three/);
  assert.doesNotMatch(source, /cytoscape/i);
  assert.doesNotMatch(source, /@mts\/core/i);
});
