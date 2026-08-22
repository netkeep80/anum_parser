import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  auditReadability3d,
  buildLodPlan3d,
  buildPerformanceBudget3d,
  chooseLod3d,
  optimizeReadability3d,
  screenSpaceDiagnostics3d,
} from "../src/readability3d.js";

function simpleScene() {
  return {
    nodes: [
      { id: "R", linkId: "R", root: true, color: "#67e8b3" },
      { id: "A", linkId: "A", root: false, color: "#67e8b3" },
      { id: "B", linkId: "B", root: false, color: "#67e8b3" },
      { id: "C", linkId: "C", root: false, color: "#67e8b3" },
    ],
    arcs: [
      {
        arcId: "arc:AB",
        linkId: "A",
        semanticSource: "A",
        semanticTarget: "B",
        self: false,
        arrow: "target",
        colorFrom: "#67e8b3",
        colorTo: "#73a7ff",
        points: [
          { x: -1, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
      },
      {
        arcId: "arc:CD",
        linkId: "C",
        semanticSource: "C",
        semanticTarget: "R",
        self: false,
        arrow: "none",
        colorFrom: "#ff657a",
        colorTo: "#67e8b3",
        points: [
          { x: 0, y: -1, z: 0.08 },
          { x: 0, y: 1, z: 0.08 },
        ],
      },
    ],
  };
}

test("world-space audit видит center, curve-center и curve-curve near collisions", () => {
  const positions = {
    R: { x: 0, y: 2, z: 0 },
    A: { x: -1, y: 0, z: 0 },
    B: { x: 1, y: 0, z: 0 },
    C: { x: -0.9, y: 0.05, z: 0 },
  };
  const audit = auditReadability3d(positions, simpleScene(), {
    minimumCenterDistance: 0.2,
    minimumCurveCenterDistance: 0.2,
    minimumCurveCurveDistance: 0.12,
  });

  assert.equal(audit.allFinite, true);
  assert.ok(audit.centers.violations >= 1);
  assert.ok(audit.curveCenter.violations >= 1);
  assert.ok(audit.curveCurve.violations >= 1);
  assert.ok(audit.penalty > 0);
  assert.ok(Number.isFinite(audit.penalty));
});

test("readability evaluation counts жёстко bounded и сообщают truncation", () => {
  const positions = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `N${index}`,
      { x: index * 0.1, y: 0, z: 0 },
    ]),
  );
  const points = Array.from({ length: 20 }, (_, index) => ({ x: index * 0.05, y: 0.03, z: 0 }));
  const scene = {
    arcs: Array.from({ length: 8 }, (_, index) => ({
      arcId: `A${index}`,
      semanticSource: `N${index}`,
      semanticTarget: `N${index + 1}`,
      points,
    })),
  };
  const audit = auditReadability3d(positions, scene, {
    maxCenterPairEvaluations: 7,
    maxCurveCenterEvaluations: 11,
    maxCurveCurveEvaluations: 13,
  });

  assert.equal(audit.centers.evaluations, 7);
  assert.equal(audit.curveCenter.evaluations, 11);
  assert.equal(audit.curveCurve.evaluations, 13);
  assert.equal(audit.evaluations, 31);
  assert.equal(audit.truncated, true);
});

test("bounded center postprocess детерминирован, разводит центры и фиксирует root", () => {
  const input = {
    R: { x: 0, y: 0, z: 0 },
    A: { x: 0.04, y: 0, z: 0 },
    B: { x: 0.08, y: 0, z: 0 },
  };
  const options = {
    minimumCenterDistance: 0.5,
    maxPasses: 12,
    correctionFraction: 1,
    maxCorrectionPerPass: 0.25,
  };
  const first = optimizeReadability3d({ positions: input, rootId: "R" }, options);
  const second = optimizeReadability3d({ positions: input, rootId: "R" }, options);

  assert.deepEqual(first, second);
  assert.deepEqual(first.positions.R, { x: 0, y: 0, z: 0 });
  assert.equal(first.metrics.rootFixed, true);
  assert.equal(first.metrics.allFinite, true);
  assert.ok(first.metrics.passes <= 12);
  assert.equal(first.audit.centers.violations, 0);
  assert.deepEqual(input.R, { x: 0, y: 0, z: 0 });
  assert.deepEqual(input.A, { x: 0.04, y: 0, z: 0 });
});

test("energy drift veto не позволяет readability correction разрушить physical equilibrium", () => {
  const input = {
    R: { x: 0, y: 0, z: 0 },
    A: { x: 0.05, y: 0, z: 0 },
  };
  const result = optimizeReadability3d({
    positions: input,
    rootId: "R",
    energyEvaluator: (positions) => positions.A.x === 0.05 ? 10 : 100,
  }, {
    minimumCenterDistance: 0.5,
    maxPasses: 4,
    maxEnergyIncreaseRatio: 0.1,
  });

  assert.equal(result.metrics.rejectedByEnergy, true);
  assert.equal(result.metrics.passes, 0);
  assert.deepEqual(result.positions, input);
  assert.equal(result.metrics.initialEnergy, 10);
  assert.equal(result.metrics.finalEnergy, 10);
});

test("sceneBuilder оценивает curves уже по postprocessed positions", () => {
  let seen = null;
  const result = optimizeReadability3d({
    positions: {
      R: { x: 0, y: 0, z: 0 },
      A: { x: 0.02, y: 0, z: 0 },
    },
    rootId: "R",
    sceneBuilder: (positions) => {
      seen = structuredClone(positions);
      return { arcs: [] };
    },
  }, {
    minimumCenterDistance: 0.4,
    maxPasses: 2,
  });

  assert.deepEqual(seen, result.positions);
  assert.deepEqual(result.positions.R, { x: 0, y: 0, z: 0 });
});

test("LOD: root/selected/current всегда full, остальные full/mid/far по distance", () => {
  const options = { nearDistance: 5, farDistance: 15 };
  assert.equal(chooseLod3d({ distance: 100, root: true }, options), "full");
  assert.equal(chooseLod3d({ distance: 100, selected: true }, options), "full");
  assert.equal(chooseLod3d({ distance: 100, current: true }, options), "full");
  assert.equal(chooseLod3d({ distance: 4 }, options), "full");
  assert.equal(chooseLod3d({ distance: 10 }, options), "mid");
  assert.equal(chooseLod3d({ distance: 40 }, options), "far");
});

test("LOD plan не меняет semantic RGB и self-loop не исчезает", () => {
  const scene = {
    nodes: [
      { linkId: "R", root: true, color: "#67e8b3" },
      { linkId: "A", root: false, color: "#67e8b3" },
      { linkId: "B", root: false, color: "#67e8b3" },
    ],
    arcs: [
      {
        arcId: "start:A",
        linkId: "A",
        semanticSource: "A",
        semanticTarget: "A",
        self: true,
        colorFrom: "#ff657a",
        colorTo: "#67e8b3",
      },
      {
        arcId: "end:A",
        linkId: "A",
        semanticSource: "A",
        semanticTarget: "B",
        self: false,
        colorFrom: "#67e8b3",
        colorTo: "#73a7ff",
      },
    ],
  };
  const presentation = {
    nodes: [
      { linkId: "R", current: false, selected: false },
      { linkId: "A", current: false, selected: true },
      { linkId: "B", current: false, selected: false },
    ],
  };
  const plan = buildLodPlan3d(scene, presentation, { R: 100, A: 100, B: 100 });

  assert.equal(plan.nodes.find((node) => node.linkId === "R").tier, "full");
  assert.equal(plan.nodes.find((node) => node.linkId === "A").tier, "full");
  assert.equal(plan.nodes.find((node) => node.linkId === "B").tier, "far");
  assert.ok(plan.nodes.every((node) => node.semanticColor === "#67e8b3"));
  assert.deepEqual(
    plan.arcs.map((arc) => [arc.arcId, arc.colorFrom, arc.colorTo, arc.visible]),
    [
      ["start:A", "#ff657a", "#67e8b3", true],
      ["end:A", "#67e8b3", "#73a7ff", true],
    ],
  );
  assert.equal(plan.arcs.find((arc) => arc.self).tier, "full");
});

function budgetFixture(size) {
  const nodes = Array.from({ length: size }, (_, index) => ({
    id: `N${index}`,
    linkId: `N${index}`,
    root: index === 0,
    color: "#67e8b3",
  }));
  const arcs = [];
  for (let index = 0; index < size; index += 1) {
    const next = (index + 1) % size;
    arcs.push({
      arcId: `start:${index}`,
      semanticSource: `N${next}`,
      semanticTarget: `N${index}`,
      arrow: "none",
      points: Array.from({ length: 10 }, (_, point) => ({ x: point, y: index, z: 0 })),
    });
    arcs.push({
      arcId: `end:${index}`,
      semanticSource: `N${index}`,
      semanticTarget: `N${next}`,
      arrow: "target",
      points: Array.from({ length: 10 }, (_, point) => ({ x: point, y: index + 0.1, z: 0 })),
    });
  }
  const iterations = 5;
  return {
    visualModel: { nodes, arcs },
    sceneData: { nodes, arcs },
    physicalState: {
      metrics: {
        iterations,
        evaluations: {
          springs: iterations * arcs.length,
          chargePairs: iterations * (size * (size - 1) / 2),
        },
      },
    },
    readabilityAudit: { evaluations: Math.min(325000, size * size) },
  };
}

for (const size of [25, 100, 300]) {
  test(`N=${size} budget report остаётся bounded по counts`, () => {
    const input = budgetFixture(size);
    const report = buildPerformanceBudget3d(input);

    assert.equal(report.observed.visibleLinks, size);
    assert.equal(report.observed.semanticArcs, size * 2);
    assert.equal(report.observed.arcVertices, size * 20);
    assert.equal(report.observed.chargePairLimitPerIteration, size * (size - 1) / 2);
    assert.equal(
      report.observed.chargePairEvaluations,
      input.physicalState.metrics.iterations * report.observed.chargePairLimitPerIteration,
    );
    assert.equal(report.withinBudget, true);
    assert.deepEqual(report.violations, []);
  });
}

test("budget report fail-closed перечисляет превышенные bounded dimensions", () => {
  const input = budgetFixture(301);
  const report = buildPerformanceBudget3d(input, {
    maxVisibleLinks: 300,
    maxSemanticArcs: 600,
    maxArcVertices: 1000,
    maxSceneObjects: 1000,
    maxReadabilityEvaluations: 10,
  });

  assert.equal(report.withinBudget, false);
  assert.ok(report.violations.includes("visibleLinks"));
  assert.ok(report.violations.includes("semanticArcs"));
  assert.ok(report.violations.includes("arcVertices"));
  assert.ok(report.violations.includes("sceneObjects"));
  assert.ok(report.violations.includes("readabilityEvaluations"));
});

test("screen-space diagnostics только измеряет overlap и не меняет world state", () => {
  const nodes = [
    { id: "A", x: 10, y: 10, radius: 5, selected: true },
    { id: "B", x: 14, y: 10, radius: 5 },
    { id: "C", x: 40, y: 40, radius: 3 },
  ];
  const labels = [
    { left: 0, top: 0, right: 20, bottom: 10 },
    { left: 10, top: 5, right: 30, bottom: 15 },
    { left: 50, top: 50, right: 60, bottom: 60 },
  ];
  const before = structuredClone({ nodes, labels });
  const diagnostics = screenSpaceDiagnostics3d({ nodes, labels });

  assert.deepEqual(diagnostics, {
    projectedNodeOverlaps: 1,
    importantNodeOverlaps: 1,
    labelOverlaps: 1,
  });
  assert.deepEqual({ nodes, labels }, before);
});

test("pure readability module не импортирует renderer/MTS и не использует random/time seed", async () => {
  const source = await readFile(new URL("../src/readability3d.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /from\s+["']three/);
  assert.doesNotMatch(source, /cytoscape/i);
  assert.doesNotMatch(source, /@mts\/core/i);
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /Date\s*\./);
  assert.doesNotMatch(source, /performance\.now/);
});
