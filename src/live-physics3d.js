import {
  addVec3,
  isFiniteVec3,
  normVec3,
  scaleVec3,
} from "./geometry3d.js";
import {
  buildPhysicalModel3d,
  computePhysicalForces3d,
  createPhysicalState3d,
  kineticEnergy3d,
  normalizePhysics3dOptions,
  physicalPotentialEnergy3d,
} from "./physics3d.js";

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
const PHYSICS_EPSILON = 1e-12;

function cloneVec3(vector) {
  return {
    x: Number(vector?.x ?? 0),
    y: Number(vector?.y ?? 0),
    z: Number(vector?.z ?? 0),
  };
}

function zeroVec3() {
  return { x: 0, y: 0, z: 0 };
}

function clampMagnitude3d(vector, maximum) {
  const length = normVec3(vector);
  if (!Number.isFinite(length)) return zeroVec3();
  if (length <= maximum || length <= PHYSICS_EPSILON) return cloneVec3(vector);
  return scaleVec3(vector, maximum / length);
}

function clampCoordinate3d(position, bound) {
  const radius = normVec3(position);
  if (!Number.isFinite(radius)) return zeroVec3();
  if (radius <= bound || radius <= PHYSICS_EPSILON) return cloneVec3(position);
  return scaleVec3(position, bound / radius);
}

function hasDynamicNode(physicalModel) {
  return physicalModel.nodeIds.some((id) => id !== physicalModel.rootId);
}

function enforceRootConstraint(simulation) {
  const rootId = simulation.physicalModel.rootId;
  if (rootId == null) return;
  simulation.positions[rootId] = zeroVec3();
  simulation.velocities[rootId] = zeroVec3();
}

function integrateLiveState3d(simulation, forces) {
  const { physicalModel, options } = simulation;
  let maxSpeed = 0;

  for (const id of physicalModel.nodeIds) {
    if (id === physicalModel.rootId) {
      simulation.positions[id] = zeroVec3();
      simulation.velocities[id] = zeroVec3();
      continue;
    }

    const currentVelocity = simulation.velocities[id] ?? ZERO;
    let velocity = addVec3(
      currentVelocity,
      scaleVec3(forces[id] ?? ZERO, options.timeStep),
    );
    velocity = scaleVec3(velocity, options.damping);
    velocity = clampMagnitude3d(velocity, options.maxVelocity);

    let displacement = scaleVec3(velocity, options.timeStep);
    const unclampedDisplacement = displacement;
    displacement = clampMagnitude3d(displacement, options.maxStep);
    if (normVec3(displacement) + PHYSICS_EPSILON < normVec3(unclampedDisplacement)) {
      velocity = scaleVec3(displacement, 1 / options.timeStep);
    }

    let position = addVec3(simulation.positions[id] ?? ZERO, displacement);
    if (!isFiniteVec3(position)) position = cloneVec3(simulation.positions[id] ?? ZERO);
    position = clampCoordinate3d(position, options.coordinateBound);

    simulation.positions[id] = position;
    simulation.velocities[id] = velocity;
    maxSpeed = Math.max(maxSpeed, normVec3(velocity));
  }

  enforceRootConstraint(simulation);
  return maxSpeed;
}

function allFiniteState(simulation) {
  return simulation.physicalModel.nodeIds.every((id) =>
    isFiniteVec3(simulation.positions[id]) && isFiniteVec3(simulation.velocities[id]));
}

function buildSnapshot(simulation, {
  stepped = false,
  maxSpeed = simulation.last?.maxSpeed ?? 0,
  energyDelta = simulation.last?.energyDelta ?? 0,
  evaluations = simulation.last?.evaluations ?? { springs: 0, chargePairs: 0, depth: 0 },
} = {}) {
  const potential = physicalPotentialEnergy3d(
    simulation.physicalModel,
    simulation.positions,
    simulation.options,
  );
  const kinetic = kineticEnergy3d(simulation.physicalModel, simulation.velocities);
  return {
    stepped,
    tick: simulation.tick,
    awake: simulation.awake,
    stableTicks: simulation.stableTicks,
    maxSpeed,
    energyDelta,
    potentialEnergy: potential.total,
    energyComponents: potential,
    kineticEnergy: kinetic,
    totalMechanicalEnergy: potential.total + kinetic,
    evaluations: { ...evaluations },
    allFinite: allFiniteState(simulation),
  };
}

export function createLivePhysicalSimulation3d(visualModel, options = {}) {
  const normalized = normalizePhysics3dOptions(options);
  const physicalModel = buildPhysicalModel3d(visualModel);
  const state = createPhysicalState3d(physicalModel, normalized);
  const potential = physicalPotentialEnergy3d(physicalModel, state.positions, normalized);
  const simulation = {
    physicalModel,
    positions: state.positions,
    velocities: state.velocities,
    options: normalized,
    awake: hasDynamicNode(physicalModel),
    stableTicks: 0,
    previousPotentialEnergy: potential.total,
    tick: 0,
    last: null,
  };
  enforceRootConstraint(simulation);
  simulation.last = buildSnapshot(simulation);
  return simulation;
}

export function wakeLivePhysicalSimulation3d(simulation) {
  simulation.awake = hasDynamicNode(simulation.physicalModel);
  simulation.stableTicks = 0;
  simulation.previousPotentialEnergy = physicalPotentialEnergy3d(
    simulation.physicalModel,
    simulation.positions,
    simulation.options,
  ).total;
  simulation.last = buildSnapshot(simulation, { stepped: false, energyDelta: 0 });
  return simulation.awake;
}

export function sleepLivePhysicalSimulation3d(simulation) {
  simulation.awake = false;
  simulation.stableTicks = simulation.options.settleWindow;
  simulation.last = buildSnapshot(simulation, { stepped: false });
  return false;
}

export function setLivePhysicalSimulationOptions3d(simulation, patch = {}) {
  simulation.options = normalizePhysics3dOptions({ ...simulation.options, ...patch });
  wakeLivePhysicalSimulation3d(simulation);
  return simulation.options;
}

export function stepLivePhysicalSimulation3d(simulation) {
  if (!simulation.awake) {
    simulation.last = buildSnapshot(simulation, { stepped: false });
    return simulation.last;
  }

  const forceResult = computePhysicalForces3d(
    simulation.physicalModel,
    simulation.positions,
    simulation.options,
  );
  const maxSpeed = integrateLiveState3d(simulation, forceResult.forces);
  const potential = physicalPotentialEnergy3d(
    simulation.physicalModel,
    simulation.positions,
    simulation.options,
  );
  const energyDelta = Math.abs(potential.total - simulation.previousPotentialEnergy);

  if (
    maxSpeed <= simulation.options.settleVelocity
    && energyDelta <= simulation.options.settleEnergyTolerance
  ) {
    simulation.stableTicks += 1;
  } else {
    simulation.stableTicks = 0;
  }

  simulation.previousPotentialEnergy = potential.total;
  simulation.tick += 1;
  if (simulation.stableTicks >= simulation.options.settleWindow) {
    simulation.awake = false;
  }

  simulation.last = buildSnapshot(simulation, {
    stepped: true,
    maxSpeed,
    energyDelta,
    evaluations: forceResult.evaluations,
  });
  return simulation.last;
}

export function livePhysicalSimulationSnapshot3d(simulation) {
  simulation.last = buildSnapshot(simulation, { stepped: false });
  return simulation.last;
}
