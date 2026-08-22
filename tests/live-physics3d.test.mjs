import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normVec3 } from "../src/geometry3d.js";
import {
  createLivePhysicalSimulation3d,
  livePhysicalSimulationSnapshot3d,
  setLivePhysicalSimulationOptions3d,
  sleepLivePhysicalSimulation3d,
  stepLivePhysicalSimulation3d,
  wakeLivePhysicalSimulation3d,
} from "../src/live-physics3d.js";
import { solvePhysicalLayout3d } from "../src/physics3d.js";
import { buildVisualModel } from "../src/visual-model.js";

function fixtureVisualModel() {
  return buildVisualModel({
    root: "R",
    links: [
      { id: "R", start: "R", end: "R" },
      { id: "A", start: "R", end: "B" },
      { id: "B", start: "A", end: "R" },
      { id: "C", start: "C", end: "B" },
    ],
  });
}

function singleFreeNodeVisualModel() {
  return {
    rootId: null,
    nodes: [{ id: "A", linkId: "A" }],
    arcs: [],
  };
}

function cloneObservableState(simulation) {
  return {
    positions: structuredClone(simulation.positions),
    velocities: structuredClone(simulation.velocities),
    awake: simulation.awake,
    stableTicks: simulation.stableTicks,
    tick: simulation.tick,
    last: structuredClone(simulation.last),
  };
}

test("один live tick совпадает с одним шагом offline solver", () => {
  const visual = fixtureVisualModel();
  const options = {
    maxIterations: 1,
    settleVelocity: 0,
    settleEnergyTolerance: 0,
    depthStrength: 0,
  };
  const offline = solvePhysicalLayout3d(visual, options);
  const live = createLivePhysicalSimulation3d(visual, options);
  const step = stepLivePhysicalSimulation3d(live);

  assert.equal(step.stepped, true);
  assert.deepEqual(live.positions, offline.positions);
  assert.deepEqual(live.velocities, offline.velocities);
  assert.equal(step.maxSpeed, offline.metrics.maxSpeed);
  assert.equal(step.potentialEnergy, offline.metrics.potentialEnergy);
  assert.equal(step.kineticEnergy, offline.metrics.kineticEnergy);
  assert.deepEqual(step.evaluations, {
    springs: offline.physicalModel.springs.length,
    chargePairs: offline.physicalModel.nodeIds.length
      * (offline.physicalModel.nodeIds.length - 1) / 2,
    depth: 0,
  });
});

test("одинаковые live simulations дают детерминированную последовательность tick-ов", () => {
  const visual = fixtureVisualModel();
  const options = {
    settleVelocity: 0,
    settleEnergyTolerance: 0,
    depthStrength: 0,
  };
  const first = createLivePhysicalSimulation3d(visual, options);
  const second = createLivePhysicalSimulation3d(visual, options);

  for (let index = 0; index < 25; index += 1) {
    assert.deepEqual(
      stepLivePhysicalSimulation3d(first),
      stepLivePhysicalSimulation3d(second),
    );
  }
  assert.deepEqual(cloneObservableState(first), cloneObservableState(second));
});

test("возмущённая свободная система движется, засыпает и может быть разбужена", () => {
  const simulation = createLivePhysicalSimulation3d(singleFreeNodeVisualModel(), {
    initialVelocities: { A: { x: 1, y: 0, z: 0 } },
    springStiffness: 0,
    chargeStrength: 0,
    damping: 0.5,
    timeStep: 1,
    maxVelocity: 2,
    maxStep: 2,
    settleVelocity: 0.02,
    settleEnergyTolerance: 0,
    settleWindow: 2,
  });
  const initialX = simulation.positions.A.x;

  let guard = 0;
  while (simulation.awake && guard < 30) {
    stepLivePhysicalSimulation3d(simulation);
    guard += 1;
  }

  assert.ok(guard > 0 && guard < 30);
  assert.equal(simulation.awake, false);
  assert.ok(simulation.positions.A.x > initialX);
  const sleepingTick = simulation.tick;
  const sleepingStep = stepLivePhysicalSimulation3d(simulation);
  assert.equal(sleepingStep.stepped, false);
  assert.equal(simulation.tick, sleepingTick);

  assert.equal(wakeLivePhysicalSimulation3d(simulation), true);
  assert.equal(simulation.awake, true);
  assert.equal(simulation.stableTicks, 0);
  const resumed = stepLivePhysicalSimulation3d(simulation);
  assert.equal(resumed.stepped, true);
  assert.equal(simulation.tick, sleepingTick + 1);
});

test("изменение параметров будит simulation без сброса текущих координат", () => {
  const simulation = createLivePhysicalSimulation3d(singleFreeNodeVisualModel(), {
    chargeStrength: 0,
    springStiffness: 0,
  });
  sleepLivePhysicalSimulation3d(simulation);
  const before = structuredClone(simulation.positions);

  const options = setLivePhysicalSimulationOptions3d(simulation, {
    charge: 1.7,
    springStiffness: 0.2,
    damping: 0.72,
  });

  assert.equal(options.charge, 1.7);
  assert.equal(options.springStiffness, 0.2);
  assert.equal(options.damping, 0.72);
  assert.equal(simulation.awake, true);
  assert.deepEqual(simulation.positions, before);
});

test("root остаётся строго в origin на каждом live tick", () => {
  const simulation = createLivePhysicalSimulation3d(fixtureVisualModel(), {
    initialPositions: { R: { x: 50, y: -40, z: 30 } },
    initialVelocities: {
      R: { x: 10, y: 10, z: 10 },
      A: { x: 1, y: -0.5, z: 0.25 },
    },
    settleVelocity: 0,
    settleEnergyTolerance: 0,
  });

  for (let index = 0; index < 40; index += 1) {
    stepLivePhysicalSimulation3d(simulation);
    assert.deepEqual(simulation.positions.R, { x: 0, y: 0, z: 0 });
    assert.deepEqual(simulation.velocities.R, { x: 0, y: 0, z: 0 });
  }
});

test("live runtime сохраняет finite/bounded state под сильным возмущением", () => {
  const simulation = createLivePhysicalSimulation3d(fixtureVisualModel(), {
    initialVelocities: {
      A: { x: 1000, y: -1000, z: 500 },
      B: { x: -1000, y: 500, z: 1000 },
    },
    chargeStrength: 5,
    springStiffness: 2,
    coordinateBound: 6,
    maxVelocity: 1,
    maxStep: 0.15,
    settleVelocity: 0,
    settleEnergyTolerance: 0,
  });

  for (let index = 0; index < 120; index += 1) {
    const step = stepLivePhysicalSimulation3d(simulation);
    assert.equal(step.allFinite, true);
    for (const position of Object.values(simulation.positions)) {
      assert.ok(normVec3(position) <= 6 + 1e-9);
    }
  }
  assert.equal(livePhysicalSimulationSnapshot3d(simulation).allFinite, true);
});

test("live physics runtime не зависит от renderer, MTS, random или wall clock", async () => {
  const source = await readFile(new URL("../src/live-physics3d.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /three(?:\.js)?/i);
  assert.doesNotMatch(source, /cytoscape/i);
  assert.doesNotMatch(source, /@mts\/core/i);
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /Date\s*\./);
  assert.doesNotMatch(source, /performance\.now/);
});
