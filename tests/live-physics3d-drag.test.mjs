import assert from "node:assert/strict";
import test from "node:test";

import { normVec3, subtractVec3 } from "../src/geometry3d.js";
import {
  createLivePhysicalSimulation3d,
  isLivePhysicalNodePinned3d,
  movePinnedLivePhysicalNode3d,
  pinLivePhysicalNode3d,
  releaseLivePhysicalNode3d,
  stepLivePhysicalSimulation3d,
} from "../src/live-physics3d.js";
import { buildVisualModel } from "../src/visual-model.js";

function fixtureVisualModel() {
  return buildVisualModel({
    root: "R",
    links: [
      { id: "R", start: "R", end: "R" },
      { id: "A", start: "R", end: "B" },
      { id: "B", start: "A", end: "R" },
      { id: "C", start: "A", end: "B" },
    ],
  });
}

function distance(left, right) {
  return normVec3(subtractVec3(left, right));
}

test("drag pin удерживает центр точно в kinematic target, пока остальные узлы движутся", () => {
  const simulation = createLivePhysicalSimulation3d(fixtureVisualModel(), {
    damping: 0.9,
    settleVelocity: 0,
    settleEnergyTolerance: 0,
  });
  const beforeB = structuredClone(simulation.positions.B);
  const target = { x: 5, y: -2, z: 1.5 };

  assert.equal(pinLivePhysicalNode3d(simulation, "A", target), true);
  assert.equal(isLivePhysicalNodePinned3d(simulation, "A"), true);

  for (let index = 0; index < 12; index += 1) {
    stepLivePhysicalSimulation3d(simulation);
    assert.deepEqual(simulation.positions.A, target);
    assert.deepEqual(simulation.velocities.A, { x: 0, y: 0, z: 0 });
    assert.deepEqual(simulation.positions.R, { x: 0, y: 0, z: 0 });
  }

  assert.ok(distance(simulation.positions.B, beforeB) > 1e-4);
});

test("pinned target можно двигать без пересоздания simulation", () => {
  const simulation = createLivePhysicalSimulation3d(fixtureVisualModel());
  const initialTick = simulation.tick;

  assert.equal(pinLivePhysicalNode3d(simulation, "C", { x: 2, y: 1, z: 0 }), true);
  assert.equal(movePinnedLivePhysicalNode3d(simulation, "C", { x: -3, y: 4, z: 2 }), true);
  assert.deepEqual(simulation.positions.C, { x: -3, y: 4, z: 2 });
  assert.equal(simulation.tick, initialTick);

  stepLivePhysicalSimulation3d(simulation);
  assert.deepEqual(simulation.positions.C, { x: -3, y: 4, z: 2 });
  assert.equal(simulation.tick, initialTick + 1);
});

test("release снимает pin и возвращает узел свободной физике", () => {
  const simulation = createLivePhysicalSimulation3d(fixtureVisualModel(), {
    settleVelocity: 0,
    settleEnergyTolerance: 0,
  });
  const target = { x: 4, y: 3, z: -2 };

  assert.equal(pinLivePhysicalNode3d(simulation, "A", target), true);
  stepLivePhysicalSimulation3d(simulation);
  assert.equal(releaseLivePhysicalNode3d(simulation, "A"), true);
  assert.equal(isLivePhysicalNodePinned3d(simulation, "A"), false);
  assert.equal(simulation.awake, true);

  const released = structuredClone(simulation.positions.A);
  for (let index = 0; index < 6; index += 1) stepLivePhysicalSimulation3d(simulation);
  assert.ok(distance(simulation.positions.A, released) > 1e-5);
});

test("root нельзя pin/drag, и некорректные targets отклоняются", () => {
  const simulation = createLivePhysicalSimulation3d(fixtureVisualModel());

  assert.equal(pinLivePhysicalNode3d(simulation, "R", { x: 8, y: 9, z: 10 }), false);
  assert.equal(pinLivePhysicalNode3d(simulation, "missing", { x: 1, y: 2, z: 3 }), false);
  assert.equal(pinLivePhysicalNode3d(simulation, "A", { x: Number.NaN, y: 0, z: 0 }), false);
  assert.equal(movePinnedLivePhysicalNode3d(simulation, "A", { x: 1, y: 2, z: 3 }), false);
  assert.equal(releaseLivePhysicalNode3d(simulation, "A"), false);
  assert.deepEqual(simulation.positions.R, { x: 0, y: 0, z: 0 });
});

test("drag target соблюдает coordinateBound", () => {
  const simulation = createLivePhysicalSimulation3d(fixtureVisualModel(), {
    coordinateBound: 3,
  });

  assert.equal(pinLivePhysicalNode3d(simulation, "A", { x: 100, y: 0, z: 0 }), true);
  assert.ok(normVec3(simulation.positions.A) <= 3 + 1e-12);
  assert.equal(movePinnedLivePhysicalNode3d(simulation, "A", { x: 0, y: -100, z: 0 }), true);
  assert.ok(normVec3(simulation.positions.A) <= 3 + 1e-12);
});
