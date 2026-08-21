import { analyzePathCrossings } from "./layout-postprocessor.js";

const EPSILON = 1e-9;
const ROTATION_STEPS = Object.freeze([-2, -1, 1, 2]);

// Crossing minimizer for the rooted structural layout. Every candidate is
// projected back to the node's assigned ring, so optimization changes angle
// but cannot change structural depth/radius.
export function minimizeRootedArcCrossings({
  positions,
  center,
  buildPaths,
  projectPosition,
  fixedIds = [],
  maxPasses = 4,
  maxHotNodes = 12,
  maxEvaluations = 240,
  minimumSpacing = 42,
  initialAngleStep = Math.PI / 9,
  displacementWeight = 0.12,
} = {}) {
  if (typeof buildPaths !== "function") {
    throw new TypeError("minimizeRootedArcCrossings: buildPaths должен быть функцией");
  }
  if (typeof projectPosition !== "function") {
    throw new TypeError("minimizeRootedArcCrossings: projectPosition должен быть функцией");
  }

  const baseline = clonePositions(positions);
  const rootCenter = finitePoint(center) ? { ...center } : { x: 0, y: 0 };
  const fixed = new Set(fixedIds.filter((id) => baseline[id]));
  let evaluations = 0;

  const evaluate = (candidate) => {
    evaluations += 1;
    const paths = buildPaths(candidate) ?? [];
    const crossings = analyzePathCrossings(paths);
    return {
      paths,
      crossings: crossings.count,
      hotNodeCounts: crossings.hotNodeCounts,
      secondary: totalPathLength(paths)
        + displacementWeight * displacementCost(candidate, baseline),
    };
  };

  const initialEvaluation = evaluate(baseline);
  if (initialEvaluation.crossings === 0 || Object.keys(baseline).length < 2) {
    return snapshot(baseline, initialEvaluation, initialEvaluation, evaluations, 0, false);
  }

  let current = clonePositions(baseline);
  let currentEvaluation = initialEvaluation;
  let passesUsed = 0;

  for (let pass = 0; pass < maxPasses && evaluations < maxEvaluations; pass += 1) {
    passesUsed = pass + 1;
    const hotIds = Object.entries(currentEvaluation.hotNodeCounts)
      .filter(([id]) => current[id] && !fixed.has(id))
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, maxHotNodes)
      .map(([id]) => id);
    if (hotIds.length === 0) break;

    const angleStep = initialAngleStep * Math.pow(0.62, pass);
    let best = null;
    const consider = (candidate, tag) => {
      if (evaluations >= maxEvaluations) return;
      const evaluation = evaluate(candidate);
      if (!isBetter(evaluation, currentEvaluation)) return;
      if (!best || isBetter(evaluation, best.evaluation)) {
        best = { positions: candidate, evaluation, tag };
      }
    };

    // Swapping angular directions is especially effective because it can make
    // large topological changes while keeping every node on its own ring.
    for (let leftIndex = 0; leftIndex < hotIds.length && evaluations < maxEvaluations; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < hotIds.length && evaluations < maxEvaluations; rightIndex += 1) {
        const leftId = hotIds[leftIndex];
        const rightId = hotIds[rightIndex];
        const candidate = clonePositions(current);
        candidate[leftId] = projectPosition(leftId, current[rightId]);
        candidate[rightId] = projectPosition(rightId, current[leftId]);
        if (!preservesSpacing(leftId, candidate[leftId], candidate, minimumSpacing)) continue;
        if (!preservesSpacing(rightId, candidate[rightId], candidate, minimumSpacing)) continue;
        consider(candidate, `angular-swap:${leftId}:${rightId}`);
      }
    }

    // Local angular refinement. Rotation is followed by the same radial
    // projection to make the invariant explicit even under floating point drift.
    for (const id of hotIds) {
      if (evaluations >= maxEvaluations) break;
      for (const multiplier of ROTATION_STEPS) {
        if (evaluations >= maxEvaluations) break;
        const rotated = rotateAround(rootCenter, current[id], multiplier * angleStep);
        const target = projectPosition(id, rotated);
        if (!preservesSpacing(id, target, current, minimumSpacing)) continue;
        const candidate = clonePositions(current);
        candidate[id] = target;
        consider(candidate, `angular-move:${id}:${multiplier}`);
      }
    }

    if (!best) continue;
    current = best.positions;
    currentEvaluation = best.evaluation;
    if (currentEvaluation.crossings === 0) break;
  }

  // Preserve the #53 no-cosmetic-motion rule: if the bounded search did not
  // actually reduce crossings, keep the deterministic structural baseline.
  if (currentEvaluation.crossings >= initialEvaluation.crossings) {
    return snapshot(baseline, initialEvaluation, initialEvaluation, evaluations, passesUsed, false);
  }

  return snapshot(
    current,
    initialEvaluation,
    currentEvaluation,
    evaluations,
    passesUsed,
    !samePositions(baseline, current),
  );
}

function snapshot(positions, before, after, evaluations, passes, changed) {
  return {
    positions: clonePositions(positions),
    crossingsBefore: before.crossings,
    crossingsAfter: after.crossings,
    evaluations,
    passes,
    changed,
  };
}

function isBetter(candidate, current) {
  if (candidate.crossings !== current.crossings) return candidate.crossings < current.crossings;
  return candidate.secondary < current.secondary - EPSILON;
}

function rotateAround(center, point, angle) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  };
}

function preservesSpacing(id, target, positions, minimumSpacing) {
  if (!finitePoint(target)) return false;
  for (const [otherId, other] of Object.entries(positions)) {
    if (otherId === id || !finitePoint(other)) continue;
    if (distance(target, other) + EPSILON < minimumSpacing) return false;
  }
  return true;
}

function totalPathLength(paths) {
  let total = 0;
  for (const path of paths) {
    for (let index = 1; index < (path.points?.length ?? 0); index += 1) {
      total += distance(path.points[index - 1], path.points[index]);
    }
  }
  return total;
}

function displacementCost(positions, baseline) {
  let total = 0;
  for (const [id, point] of Object.entries(positions)) {
    if (!baseline[id]) continue;
    const displacement = distance(point, baseline[id]);
    total += displacement * displacement;
  }
  return total;
}

function clonePositions(positions = {}) {
  const result = {};
  for (const id of Object.keys(positions).sort()) {
    const point = positions[id];
    if (finitePoint(point)) result[id] = { x: point.x, y: point.y };
  }
  return result;
}

function samePositions(left, right) {
  const ids = Object.keys(left);
  if (ids.length !== Object.keys(right).length) return false;
  return ids.every((id) => distance(left[id], right[id]) <= EPSILON);
}

function distance(left, right) {
  if (!finitePoint(left) || !finitePoint(right)) return Number.POSITIVE_INFINITY;
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}
