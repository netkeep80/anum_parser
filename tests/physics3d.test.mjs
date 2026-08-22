import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isFiniteVec3, normVec3 } from "../src/geometry3d.js";
import {
  auditPhysicalTopology3d,
  buildPhysicalModel3d,
  computePhysicalForces3d,
  createPhysicalState3d,
  deterministicInitialPositions3d,
  physicalPotentialEnergy3d,
  solvePhysicalLayout3d,
} from "../src/physics3d.js";
import { buildVisualModel } from "../src/visual-model.js";

function fixtureAset() {
  return {
    root: "R",
    links: [
      { id: "R", start: "R", end: "R" },
      { id: "A", start: "R", end: "B" },
      { id: "B", start: "A", end: "R" },
      { id: "C", start: "C", end: "B" },
    ],
  };
}

function pairModel(withSpring = false) {
  return {
    nodeIds: ["A", "B"],
    rootId: null,
    springs: withSpring
      ? [{ id: "arc:A:B", arcId: "arc:A:B", linkId: "A", role: "end", sourceId: "A", targetId: "B" }]
      : [],
    selfArcIds: [],
  };
}

function finiteObjectVectors(object) {
  return Object.values(object).every(isFiniteVec3);
}

test("force topology совпадает с non-self semantic arc topology", () => {
  const visual = buildVisualModel(fixtureAset());
  const physical = buildPhysicalModel3d(visual);
  const audit = auditPhysicalTopology3d(visual, physical);

  assert.deepEqual(audit.missingSpringArcIds, []);
  assert.deepEqual(audit.hiddenSpringIds, []);
  assert.deepEqual(audit.selfForceSpringIds, []);
  assert.deepEqual(audit.springIds, audit.visibleNonSelfArcIds);
  assert.deepEqual(physical.selfArcIds, [
    "pole-start:R",
    "pole-end:R",
    "pole-start:C",
  ]);
  assert.ok(physical.springs.every((spring) => spring.id === spring.arcId));
  assert.deepEqual(
    physical.springs.map((spring) => spring.role),
    ["start", "end", "start", "end", "end"],
  );
});

test("deterministic initial placement фиксирует root и разводит остальные центры", () => {
  const physical = buildPhysicalModel3d(buildVisualModel(fixtureAset()));
  const first = deterministicInitialPositions3d(physical, { initialRadius: 3 });
  const second = deterministicInitialPositions3d(physical, { initialRadius: 3 });

  assert.deepEqual(first, second);
  assert.deepEqual(first.R, { x: 0, y: 0, z: 0 });
  assert.ok(Object.values(first).every(isFiniteVec3));
  const free = [first.A, first.B, first.C];
  for (let left = 0; left < free.length; left += 1) {
    for (let right = left + 1; right < free.length; right += 1) {
      assert.ok(normVec3({
        x: free[left].x - free[right].x,
        y: free[left].y - free[right].y,
        z: free[left].z - free[right].z,
      }) > 0.1);
    }
  }
});

test("same-sign GREEN centers отталкиваются", () => {
  const result = computePhysicalForces3d(pairModel(false), {
    A: { x: -1, y: 0, z: 0 },
    B: { x: 1, y: 0, z: 0 },
  }, {
    springStiffness: 0,
    chargeStrength: 1,
    charge: 1,
    minimumDistance: 0.1,
    softening: 0.1,
  });

  assert.ok(result.forces.A.x < 0);
  assert.ok(result.forces.B.x > 0);
  assert.ok(Math.abs(result.forces.A.x + result.forces.B.x) < 1e-12);
  assert.equal(result.evaluations.chargePairs, 1);
});

test("растянутая semantic spring притягивает центры", () => {
  const result = computePhysicalForces3d(pairModel(true), {
    A: { x: 0, y: 0, z: 0 },
    B: { x: 4, y: 0, z: 0 },
  }, {
    restLength: 2,
    springStiffness: 1,
    chargeStrength: 0,
  });

  assert.ok(result.forces.A.x > 0);
  assert.ok(result.forces.B.x < 0);
  assert.equal(result.evaluations.springs, 1);
});

test("сжатая semantic spring раздвигает центры к restLength", () => {
  const result = computePhysicalForces3d(pairModel(true), {
    A: { x: 0, y: 0, z: 0 },
    B: { x: 1, y: 0, z: 0 },
  }, {
    restLength: 2,
    springStiffness: 1,
    chargeStrength: 0,
  });

  assert.ok(result.forces.A.x < 0);
  assert.ok(result.forces.B.x > 0);
});

test("совпавшие центры получают конечное deterministic separation direction", () => {
  const positions = {
    A: { x: 0, y: 0, z: 0 },
    B: { x: 0, y: 0, z: 0 },
  };
  const options = {
    springStiffness: 0,
    chargeStrength: 1,
    minimumDistance: 0.2,
    softening: 0.1,
  };
  const first = computePhysicalForces3d(pairModel(false), positions, options);
  const second = computePhysicalForces3d(pairModel(false), positions, options);

  assert.deepEqual(first, second);
  assert.ok(isFiniteVec3(first.forces.A));
  assert.ok(isFiniteVec3(first.forces.B));
  assert.ok(normVec3(first.forces.A) > 0);
  assert.deepEqual(first.forces.B, {
    x: -first.forces.A.x,
    y: -first.forces.A.y,
    z: -first.forces.A.z,
  });
});

test("root остаётся точно в origin при любом requested warm-start", () => {
  const visual = buildVisualModel(fixtureAset());
  const physical = buildPhysicalModel3d(visual);
  const state = createPhysicalState3d(physical, {
    initialPositions: {
      R: { x: 9, y: -8, z: 7 },
      A: { x: 2, y: 0, z: 0 },
    },
    initialVelocities: {
      R: { x: 4, y: 5, z: 6 },
    },
  });

  assert.deepEqual(state.positions.R, { x: 0, y: 0, z: 0 });
  assert.deepEqual(state.velocities.R, { x: 0, y: 0, z: 0 });

  const solved = solvePhysicalLayout3d(visual, {
    maxIterations: 30,
    initialPositions: { R: { x: 100, y: 100, z: 100 } },
    initialVelocities: { R: { x: 100, y: 100, z: 100 } },
  });
  assert.deepEqual(solved.positions.R, { x: 0, y: 0, z: 0 });
  assert.deepEqual(solved.velocities.R, { x: 0, y: 0, z: 0 });
});

test("same input/options дают byte-for-byte deterministic physical result", () => {
  const visual = buildVisualModel(fixtureAset());
  const options = {
    maxIterations: 90,
    settleVelocity: 1e-5,
    settleEnergyTolerance: 1e-10,
    settleWindow: 8,
    depthStrength: 0,
  };

  assert.deepEqual(
    solvePhysicalLayout3d(visual, options),
    solvePhysicalLayout3d(visual, options),
  );
});

test("solver bounded: finite coordinates, velocities, energies и evaluation counts", () => {
  const visual = buildVisualModel(fixtureAset());
  const result = solvePhysicalLayout3d(visual, {
    maxIterations: 40,
    coordinateBound: 8,
    settleVelocity: 0,
    settleEnergyTolerance: 0,
  });
  const n = result.physicalModel.nodeIds.length;
  const pairCount = n * (n - 1) / 2;

  assert.ok(result.metrics.iterations <= 40);
  assert.ok(finiteObjectVectors(result.positions));
  assert.ok(finiteObjectVectors(result.velocities));
  assert.ok(Object.values(result.positions).every((position) => normVec3(position) <= 8 + 1e-9));
  assert.ok(Number.isFinite(result.metrics.potentialEnergy));
  assert.ok(Number.isFinite(result.metrics.kineticEnergy));
  assert.ok(Number.isFinite(result.metrics.totalMechanicalEnergy));
  assert.equal(result.metrics.allFinite, true);
  assert.equal(
    result.metrics.evaluations.springs,
    result.metrics.iterations * result.physicalModel.springs.length,
  );
  assert.equal(
    result.metrics.evaluations.chargePairs,
    result.metrics.iterations * pairCount,
  );
  assert.equal(result.metrics.evaluations.depth, 0);
});

test("k_depth=0 полностью отключает structural-depth potential", () => {
  const visual = buildVisualModel(fixtureAset());
  const baseOptions = { maxIterations: 35, depthStrength: 0 };
  const withoutDepths = solvePhysicalLayout3d(visual, baseOptions);
  const withIgnoredDepths = solvePhysicalLayout3d(visual, {
    ...baseOptions,
    depths: { R: 0, A: 100, B: 200, C: 300 },
    depthScale: 50,
  });

  assert.deepEqual(withIgnoredDepths.positions, withoutDepths.positions);
  assert.deepEqual(withIgnoredDepths.velocities, withoutDepths.velocities);
  assert.equal(withIgnoredDepths.metrics.energyComponents.depth, 0);
});

test("enabled depth potential тянет radius к depth*depthScale", () => {
  const physical = {
    nodeIds: ["A"],
    rootId: null,
    springs: [],
    selfArcIds: [],
  };
  const result = computePhysicalForces3d(physical, {
    A: { x: 1, y: 0, z: 0 },
  }, {
    chargeStrength: 0,
    springStiffness: 0,
    depthStrength: 1,
    depthScale: 2,
    depths: { A: 2 },
  });

  assert.ok(result.forces.A.x > 0);
  assert.equal(result.evaluations.depth, 1);
});

test("self-loop-only root остаётся visual topology, но не создаёт self-force", () => {
  const visual = buildVisualModel({
    root: "R",
    links: [{ id: "R", start: "R", end: "R" }],
  });
  const solved = solvePhysicalLayout3d(visual);

  assert.equal(solved.physicalModel.springs.length, 0);
  assert.deepEqual(solved.physicalModel.selfArcIds, ["pole-start:R", "pole-end:R"]);
  assert.deepEqual(solved.positions.R, { x: 0, y: 0, z: 0 });
  assert.equal(solved.metrics.iterations, 0);
  assert.equal(solved.metrics.converged, true);
});

test("charge-only coincident free centers детерминированно перестают совпадать", () => {
  const visual = {
    rootId: null,
    nodes: [{ id: "A", linkId: "A" }, { id: "B", linkId: "B" }],
    arcs: [],
  };
  const solved = solvePhysicalLayout3d(visual, {
    initialPositions: {
      A: { x: 0, y: 0, z: 0 },
      B: { x: 0, y: 0, z: 0 },
    },
    springStiffness: 0,
    chargeStrength: 1,
    maxIterations: 10,
    settleVelocity: 0,
    settleEnergyTolerance: 0,
  });
  const separation = normVec3({
    x: solved.positions.A.x - solved.positions.B.x,
    y: solved.positions.A.y - solved.positions.B.y,
    z: solved.positions.A.z - solved.positions.B.z,
  });

  assert.ok(separation > 0.01);
  assert.equal(solved.metrics.allFinite, true);
});

test("potential energy components finite и self arcs туда не добавляются", () => {
  const visual = buildVisualModel(fixtureAset());
  const physical = buildPhysicalModel3d(visual);
  const positions = deterministicInitialPositions3d(physical);
  const energy = physicalPotentialEnergy3d(physical, positions, {
    depthStrength: 0.01,
    depths: { R: 0, A: 1, B: 2, C: 2 },
  });

  assert.ok(Number.isFinite(energy.spring));
  assert.ok(Number.isFinite(energy.charge));
  assert.ok(Number.isFinite(energy.depth));
  assert.equal(energy.total, energy.spring + energy.charge + energy.depth);
  assert.equal(physical.springs.length, 5);
});

test("N=25 exact pairwise repulsion остаётся внутри заданного iteration budget", () => {
  const nodes = Array.from({ length: 25 }, (_, index) => ({
    id: `N${String(index).padStart(2, "0")}`,
    linkId: `N${String(index).padStart(2, "0")}`,
  }));
  const result = solvePhysicalLayout3d({ rootId: null, nodes, arcs: [] }, {
    springStiffness: 0,
    maxIterations: 5,
    settleVelocity: 0,
    settleEnergyTolerance: 0,
  });

  assert.equal(result.metrics.iterations, 5);
  assert.equal(result.metrics.evaluations.chargePairs, 5 * (25 * 24 / 2));
  assert.equal(result.metrics.evaluations.springs, 0);
  assert.equal(result.metrics.allFinite, true);
});

test("pure physics не импортирует renderer/MTS и не использует random/time seed", async () => {
  const source = await readFile(new URL("../src/physics3d.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /three(?:\.js)?/i);
  assert.doesNotMatch(source, /cytoscape/i);
  assert.doesNotMatch(source, /@mts\/core/i);
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /Date\s*\./);
  assert.doesNotMatch(source, /performance\.now/);
});
