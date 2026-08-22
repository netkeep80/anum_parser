import {
  addVec3,
  isFiniteVec3,
  normVec3,
  normalizeVec3,
  scaleVec3,
  subtractVec3,
} from "./geometry3d.js";

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
const PHYSICS_EPSILON = 1e-12;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const UINT32_RANGE = 0x100000000;

export const DEFAULT_PHYSICS3D_OPTIONS = Object.freeze({
  restLength: 2,
  springStiffness: 0.055,
  charge: 1,
  chargeStrength: 0.08,
  softening: 0.35,
  minimumDistance: 0.2,
  damping: 0.86,
  timeStep: 0.2,
  maxVelocity: 1.5,
  maxStep: 0.25,
  maxIterations: 320,
  coordinateBound: 50,
  settleVelocity: 1e-3,
  settleEnergyTolerance: 1e-8,
  settleWindow: 12,
  depthStrength: 0,
  depthScale: 2.2,
  initialRadius: 3,
});

function cloneVec3(v) {
  return { x: Number(v?.x ?? 0), y: Number(v?.y ?? 0), z: Number(v?.z ?? 0) };
}

function zeroVec3() {
  return { x: 0, y: 0, z: 0 };
}

function finiteNumber(value, fallback, predicate = Number.isFinite) {
  const number = Number(value);
  return predicate(number) ? number : fallback;
}

function nonNegative(value, fallback) {
  return finiteNumber(value, fallback, (number) => Number.isFinite(number) && number >= 0);
}

function positive(value, fallback) {
  return finiteNumber(value, fallback, (number) => Number.isFinite(number) && number > 0);
}

function boundedUnit(value, fallback) {
  return Math.max(0, Math.min(1, finiteNumber(value, fallback)));
}

function stableId(value) {
  return String(value ?? "");
}

function stableCompare(a, b) {
  return stableId(a).localeCompare(stableId(b), "en", { numeric: true, sensitivity: "variant" });
}

function clonePositions(positions, nodeIds) {
  return Object.fromEntries(nodeIds.map((id) => [id, cloneVec3(positions[id] ?? ZERO)]));
}

function hash32(text, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (const character of String(text)) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function deterministicUnitFromKey(key) {
  const first = hash32(key, 0x811c9dc5);
  const second = hash32(key, 0x9e3779b9);
  const u = (first + 0.5) / UINT32_RANGE;
  const v = (second + 0.5) / UINT32_RANGE;
  const z = 1 - 2 * u;
  const radial = Math.sqrt(Math.max(0, 1 - z * z));
  const angle = Math.PI * 2 * v;
  return {
    x: radial * Math.cos(angle),
    y: radial * Math.sin(angle),
    z,
  };
}

// Детерминированное направление from -> to даже при совпавших координатах.
function pairDirection3d(fromId, toId) {
  const from = stableId(fromId);
  const to = stableId(toId);
  if (from === to) return deterministicUnitFromKey(`self:${from}`);
  const ordered = [from, to].sort(stableCompare);
  const base = deterministicUnitFromKey(`pair:${ordered[0]}\u0000${ordered[1]}`);
  return from === ordered[0] ? base : scaleVec3(base, -1);
}

function vectorDirection3d(fromId, toId, fromPosition, toPosition) {
  const delta = subtractVec3(toPosition, fromPosition);
  const distance = normVec3(delta);
  if (Number.isFinite(distance) && distance > PHYSICS_EPSILON) {
    return { direction: scaleVec3(delta, 1 / distance), distance };
  }
  return { direction: pairDirection3d(fromId, toId), distance: 0 };
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

export function normalizePhysics3dOptions(options = {}) {
  const defaults = DEFAULT_PHYSICS3D_OPTIONS;
  return {
    restLength: positive(options.restLength, defaults.restLength),
    springStiffness: nonNegative(options.springStiffness, defaults.springStiffness),
    charge: nonNegative(options.charge, defaults.charge),
    chargeStrength: nonNegative(options.chargeStrength, defaults.chargeStrength),
    softening: positive(options.softening, defaults.softening),
    minimumDistance: positive(options.minimumDistance, defaults.minimumDistance),
    damping: boundedUnit(options.damping, defaults.damping),
    timeStep: positive(options.timeStep, defaults.timeStep),
    maxVelocity: positive(options.maxVelocity, defaults.maxVelocity),
    maxStep: positive(options.maxStep, defaults.maxStep),
    maxIterations: Math.max(0, Math.floor(nonNegative(options.maxIterations, defaults.maxIterations))),
    coordinateBound: positive(options.coordinateBound, defaults.coordinateBound),
    settleVelocity: nonNegative(options.settleVelocity, defaults.settleVelocity),
    settleEnergyTolerance: nonNegative(options.settleEnergyTolerance, defaults.settleEnergyTolerance),
    settleWindow: Math.max(1, Math.floor(positive(options.settleWindow, defaults.settleWindow))),
    depthStrength: nonNegative(options.depthStrength, defaults.depthStrength),
    depthScale: nonNegative(options.depthScale, defaults.depthScale),
    initialRadius: positive(options.initialRadius, defaults.initialRadius),
    depths: options.depths ?? null,
    initialPositions: options.initialPositions ?? null,
    initialVelocities: options.initialVelocities ?? null,
  };
}

export function buildPhysicalModel3d(visualModel) {
  const nodes = Array.isArray(visualModel?.nodes) ? visualModel.nodes : [];
  const nodeIds = [];
  const knownIds = new Set();
  for (const node of nodes) {
    const id = node?.linkId ?? node?.id;
    if (id == null || knownIds.has(id)) continue;
    knownIds.add(id);
    nodeIds.push(id);
  }

  const arcs = Array.isArray(visualModel?.arcs) ? visualModel.arcs : [];
  const springs = [];
  const selfArcIds = [];
  for (const arc of arcs) {
    const sourceId = arc?.semanticSource;
    const targetId = arc?.semanticTarget;
    if (!knownIds.has(sourceId) || !knownIds.has(targetId)) continue;
    if (sourceId === targetId) {
      selfArcIds.push(arc.id);
      continue;
    }
    springs.push({
      id: arc.id,
      arcId: arc.id,
      linkId: arc.linkId,
      role: arc.role,
      sourceId,
      targetId,
    });
  }

  const rootId = knownIds.has(visualModel?.rootId) ? visualModel.rootId : null;
  return { nodeIds, rootId, springs, selfArcIds };
}

export function auditPhysicalTopology3d(visualModel, physicalModel = buildPhysicalModel3d(visualModel)) {
  const knownIds = new Set(physicalModel.nodeIds);
  const visibleNonSelfArcIds = (visualModel?.arcs ?? [])
    .filter((arc) => knownIds.has(arc.semanticSource) && knownIds.has(arc.semanticTarget))
    .filter((arc) => arc.semanticSource !== arc.semanticTarget)
    .map((arc) => arc.id);
  const visibleNonSelfSet = new Set(visibleNonSelfArcIds);
  const springIds = physicalModel.springs.map((spring) => spring.arcId);
  const springSet = new Set(springIds);

  return {
    visibleNonSelfArcIds,
    springIds,
    missingSpringArcIds: visibleNonSelfArcIds.filter((id) => !springSet.has(id)),
    hiddenSpringIds: springIds.filter((id) => !visibleNonSelfSet.has(id)),
    selfForceSpringIds: physicalModel.springs
      .filter((spring) => spring.sourceId === spring.targetId)
      .map((spring) => spring.id),
  };
}

export function deterministicInitialPositions3d(physicalModel, options = {}) {
  const normalized = normalizePhysics3dOptions(options);
  const positions = Object.fromEntries(physicalModel.nodeIds.map((id) => [id, zeroVec3()]));
  const freeIds = physicalModel.nodeIds
    .filter((id) => id !== physicalModel.rootId)
    .slice()
    .sort(stableCompare);
  const count = freeIds.length;

  for (let index = 0; index < count; index += 1) {
    const id = freeIds[index];
    const z = 1 - 2 * ((index + 0.5) / Math.max(1, count));
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    const angle = GOLDEN_ANGLE * index;
    positions[id] = scaleVec3({
      x: radial * Math.cos(angle),
      y: radial * Math.sin(angle),
      z,
    }, normalized.initialRadius);
  }

  if (physicalModel.rootId != null) positions[physicalModel.rootId] = zeroVec3();
  return positions;
}

export function createPhysicalState3d(physicalModel, options = {}) {
  const normalized = normalizePhysics3dOptions(options);
  const positions = deterministicInitialPositions3d(physicalModel, normalized);
  const velocities = Object.fromEntries(physicalModel.nodeIds.map((id) => [id, zeroVec3()]));

  for (const id of physicalModel.nodeIds) {
    if (id === physicalModel.rootId) continue;
    const requestedPosition = normalized.initialPositions?.[id];
    if (isFiniteVec3(requestedPosition)) {
      positions[id] = clampCoordinate3d(requestedPosition, normalized.coordinateBound);
    }
    const requestedVelocity = normalized.initialVelocities?.[id];
    if (isFiniteVec3(requestedVelocity)) {
      velocities[id] = clampMagnitude3d(requestedVelocity, normalized.maxVelocity);
    }
  }

  if (physicalModel.rootId != null) {
    positions[physicalModel.rootId] = zeroVec3();
    velocities[physicalModel.rootId] = zeroVec3();
  }
  return { positions, velocities };
}

function addForce(forces, id, contribution) {
  forces[id] = addVec3(forces[id] ?? ZERO, contribution);
}

export function computePhysicalForces3d(physicalModel, positions, options = {}) {
  const normalized = normalizePhysics3dOptions(options);
  const forces = Object.fromEntries(physicalModel.nodeIds.map((id) => [id, zeroVec3()]));
  const evaluations = { springs: 0, chargePairs: 0, depth: 0 };

  for (const spring of physicalModel.springs) {
    const source = positions[spring.sourceId] ?? ZERO;
    const target = positions[spring.targetId] ?? ZERO;
    const { direction, distance } = vectorDirection3d(
      spring.sourceId,
      spring.targetId,
      source,
      target,
    );
    const extension = distance - normalized.restLength;
    const contribution = scaleVec3(direction, normalized.springStiffness * extension);
    addForce(forces, spring.sourceId, contribution);
    addForce(forces, spring.targetId, scaleVec3(contribution, -1));
    evaluations.springs += 1;
  }

  const q2 = normalized.charge * normalized.charge;
  for (let left = 0; left < physicalModel.nodeIds.length; left += 1) {
    const leftId = physicalModel.nodeIds[left];
    const leftPosition = positions[leftId] ?? ZERO;
    for (let right = left + 1; right < physicalModel.nodeIds.length; right += 1) {
      const rightId = physicalModel.nodeIds[right];
      const rightPosition = positions[rightId] ?? ZERO;
      const { direction, distance } = vectorDirection3d(
        rightId,
        leftId,
        rightPosition,
        leftPosition,
      );
      const guardedDistance = Math.max(normalized.minimumDistance, distance);
      const denominator = guardedDistance * guardedDistance + normalized.softening * normalized.softening;
      const magnitude = normalized.chargeStrength * q2 / denominator;
      const contribution = scaleVec3(direction, magnitude);
      addForce(forces, leftId, contribution);
      addForce(forces, rightId, scaleVec3(contribution, -1));
      evaluations.chargePairs += 1;
    }
  }

  if (normalized.depthStrength > 0 && normalized.depths) {
    for (const id of physicalModel.nodeIds) {
      if (id === physicalModel.rootId) continue;
      const depth = Number(normalized.depths[id]);
      if (!Number.isFinite(depth) || depth < 0) continue;
      const position = positions[id] ?? ZERO;
      const radius = normVec3(position);
      const targetRadius = depth * normalized.depthScale;
      const outward = normalizeVec3(position) ?? deterministicUnitFromKey(`depth:${stableId(id)}`);
      const contribution = scaleVec3(
        outward,
        -normalized.depthStrength * (radius - targetRadius),
      );
      addForce(forces, id, contribution);
      evaluations.depth += 1;
    }
  }

  return { forces, evaluations };
}

export function physicalPotentialEnergy3d(physicalModel, positions, options = {}) {
  const normalized = normalizePhysics3dOptions(options);
  let spring = 0;
  let charge = 0;
  let depth = 0;

  for (const edge of physicalModel.springs) {
    const source = positions[edge.sourceId] ?? ZERO;
    const target = positions[edge.targetId] ?? ZERO;
    const distance = normVec3(subtractVec3(target, source));
    const extension = distance - normalized.restLength;
    spring += 0.5 * normalized.springStiffness * extension * extension;
  }

  const q2 = normalized.charge * normalized.charge;
  for (let left = 0; left < physicalModel.nodeIds.length; left += 1) {
    const leftPosition = positions[physicalModel.nodeIds[left]] ?? ZERO;
    for (let right = left + 1; right < physicalModel.nodeIds.length; right += 1) {
      const rightPosition = positions[physicalModel.nodeIds[right]] ?? ZERO;
      const rawDistance = normVec3(subtractVec3(leftPosition, rightPosition));
      const guardedDistance = Math.max(normalized.minimumDistance, rawDistance);
      charge += normalized.chargeStrength * q2
        / Math.sqrt(guardedDistance * guardedDistance + normalized.softening * normalized.softening);
    }
  }

  if (normalized.depthStrength > 0 && normalized.depths) {
    for (const id of physicalModel.nodeIds) {
      if (id === physicalModel.rootId) continue;
      const linkDepth = Number(normalized.depths[id]);
      if (!Number.isFinite(linkDepth) || linkDepth < 0) continue;
      const radius = normVec3(positions[id] ?? ZERO);
      const targetRadius = linkDepth * normalized.depthScale;
      const delta = radius - targetRadius;
      depth += 0.5 * normalized.depthStrength * delta * delta;
    }
  }

  return { spring, charge, depth, total: spring + charge + depth };
}

export function kineticEnergy3d(physicalModel, velocities) {
  let kinetic = 0;
  for (const id of physicalModel.nodeIds) {
    if (id === physicalModel.rootId) continue;
    const speed = normVec3(velocities[id] ?? ZERO);
    kinetic += 0.5 * speed * speed;
  }
  return kinetic;
}

function integratePhysicalState3d(physicalModel, state, forces, normalized) {
  let maxSpeed = 0;
  for (const id of physicalModel.nodeIds) {
    if (id === physicalModel.rootId) {
      state.positions[id] = zeroVec3();
      state.velocities[id] = zeroVec3();
      continue;
    }

    const currentVelocity = state.velocities[id] ?? ZERO;
    let velocity = addVec3(currentVelocity, scaleVec3(forces[id] ?? ZERO, normalized.timeStep));
    velocity = scaleVec3(velocity, normalized.damping);
    velocity = clampMagnitude3d(velocity, normalized.maxVelocity);

    let displacement = scaleVec3(velocity, normalized.timeStep);
    displacement = clampMagnitude3d(displacement, normalized.maxStep);
    if (normVec3(displacement) + PHYSICS_EPSILON < normVec3(scaleVec3(velocity, normalized.timeStep))) {
      velocity = scaleVec3(displacement, 1 / normalized.timeStep);
    }

    let position = addVec3(state.positions[id] ?? ZERO, displacement);
    if (!isFiniteVec3(position)) position = cloneVec3(state.positions[id] ?? ZERO);
    position = clampCoordinate3d(position, normalized.coordinateBound);

    state.positions[id] = position;
    state.velocities[id] = velocity;
    maxSpeed = Math.max(maxSpeed, normVec3(velocity));
  }

  if (physicalModel.rootId != null) {
    state.positions[physicalModel.rootId] = zeroVec3();
    state.velocities[physicalModel.rootId] = zeroVec3();
  }
  return maxSpeed;
}

export function solvePhysicalLayout3d(visualModel, options = {}) {
  const physicalModel = buildPhysicalModel3d(visualModel);
  const normalized = normalizePhysics3dOptions(options);
  const state = createPhysicalState3d(physicalModel, normalized);
  const audit = auditPhysicalTopology3d(visualModel, physicalModel);
  const initialEnergy = physicalPotentialEnergy3d(physicalModel, state.positions, normalized);
  let previousEnergy = initialEnergy.total;
  let finalEnergy = initialEnergy;
  let bestPotentialEnergy = initialEnergy.total;
  let bestPositions = clonePositions(state.positions, physicalModel.nodeIds);
  let stableIterations = 0;
  let converged = physicalModel.nodeIds.length <= 1;
  let iterations = 0;
  let maxSpeed = 0;
  const evaluations = { springs: 0, chargePairs: 0, depth: 0 };

  for (let iteration = 0; iteration < normalized.maxIterations && !converged; iteration += 1) {
    const forceResult = computePhysicalForces3d(physicalModel, state.positions, normalized);
    evaluations.springs += forceResult.evaluations.springs;
    evaluations.chargePairs += forceResult.evaluations.chargePairs;
    evaluations.depth += forceResult.evaluations.depth;

    maxSpeed = integratePhysicalState3d(physicalModel, state, forceResult.forces, normalized);
    finalEnergy = physicalPotentialEnergy3d(physicalModel, state.positions, normalized);
    iterations = iteration + 1;

    if (finalEnergy.total < bestPotentialEnergy) {
      bestPotentialEnergy = finalEnergy.total;
      bestPositions = clonePositions(state.positions, physicalModel.nodeIds);
    }

    const energyDelta = Math.abs(finalEnergy.total - previousEnergy);
    if (maxSpeed <= normalized.settleVelocity && energyDelta <= normalized.settleEnergyTolerance) {
      stableIterations += 1;
    } else {
      stableIterations = 0;
    }
    previousEnergy = finalEnergy.total;
    if (stableIterations >= normalized.settleWindow) converged = true;
  }

  finalEnergy = physicalPotentialEnergy3d(physicalModel, state.positions, normalized);
  const kineticEnergy = kineticEnergy3d(physicalModel, state.velocities);
  const allFinite = physicalModel.nodeIds.every((id) =>
    isFiniteVec3(state.positions[id]) && isFiniteVec3(state.velocities[id]));

  return {
    physicalModel,
    positions: clonePositions(state.positions, physicalModel.nodeIds),
    velocities: clonePositions(state.velocities, physicalModel.nodeIds),
    topologyAudit: audit,
    options: normalized,
    metrics: {
      iterations,
      converged,
      maxSpeed,
      potentialEnergy: finalEnergy.total,
      energyComponents: finalEnergy,
      kineticEnergy,
      totalMechanicalEnergy: finalEnergy.total + kineticEnergy,
      initialPotentialEnergy: initialEnergy.total,
      bestPotentialEnergy,
      bestPositions,
      evaluations,
      allFinite,
    },
  };
}
