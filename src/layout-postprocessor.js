const EPSILON = 1e-9;
const LOCAL_DIRECTIONS = Object.freeze([
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
]);

export function sampleQuadraticBezier(source, control, target, segments = 6) {
  const count = Math.max(2, Math.floor(segments));
  const points = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const inverse = 1 - t;
    points.push({
      x: inverse * inverse * source.x + 2 * inverse * t * control.x + t * t * target.x,
      y: inverse * inverse * source.y + 2 * inverse * t * control.y + t * t * target.y,
    });
  }
  return points;
}

export function sampleCubicBezier(source, control1, control2, target, segments = 8) {
  const count = Math.max(3, Math.floor(segments));
  const points = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const inverse = 1 - t;
    points.push({
      x: inverse ** 3 * source.x
        + 3 * inverse * inverse * t * control1.x
        + 3 * inverse * t * t * control2.x
        + t ** 3 * target.x,
      y: inverse ** 3 * source.y
        + 3 * inverse * inverse * t * control1.y
        + 3 * inverse * t * t * control2.y
        + t ** 3 * target.y,
    });
  }
  return points;
}

export function properSegmentsIntersect(a, b, c, d) {
  if (!a || !b || !c || !d) return false;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return oppositeSigns(o1, o2) && oppositeSigns(o3, o4);
}

export function analyzePathCrossings(paths) {
  const prepared = (paths ?? [])
    .filter((path) => Array.isArray(path?.points) && path.points.length >= 2)
    .map((path) => ({ ...path, box: pathBounds(path.points) }));
  const hotNodeCounts = {};
  let count = 0;

  for (let leftIndex = 0; leftIndex < prepared.length; leftIndex += 1) {
    const left = prepared[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex += 1) {
      const right = prepared[rightIndex];
      if (shareSemanticEndpoint(left, right)) continue;
      if (!boundsOverlap(left.box, right.box)) continue;
      if (!pathsProperlyIntersect(left.points, right.points)) continue;

      count += 1;
      for (const nodeId of new Set([left.source, left.target, right.source, right.target])) {
        if (!nodeId) continue;
        hotNodeCounts[nodeId] = (hotNodeCounts[nodeId] ?? 0) + 1;
      }
    }
  }

  return { count, hotNodeCounts };
}

export function minimizeArcCrossings({
  positions,
  buildPaths,
  fixedIds = [],
  maxPasses = 4,
  maxHotNodes = 10,
  maxEvaluations = 220,
  displacementWeight = 0.18,
} = {}) {
  if (typeof buildPaths !== "function") {
    throw new TypeError("minimizeArcCrossings: buildPaths должен быть функцией");
  }

  const baseline = clonePositions(positions);
  const ids = Object.keys(baseline).sort();
  const spacing = medianNearestSpacing(baseline, ids);
  const baseStep = clamp(spacing * 0.35, 18, 64);
  const minimumSpacing = clamp(spacing * 0.48, 16, 46);
  const maximumDisplacement = Math.max(baseStep * 2.4, spacing * 0.95);
  const fixed = new Set(fixedIds.filter((id) => baseline[id]));
  let evaluations = 0;

  const evaluate = (candidate) => {
    evaluations += 1;
    const paths = buildPaths(candidate) ?? [];
    const crossingAnalysis = analyzePathCrossings(paths);
    return {
      paths,
      crossings: crossingAnalysis.count,
      hotNodeCounts: crossingAnalysis.hotNodeCounts,
      secondary: totalPathLength(paths)
        + displacementWeight * displacementCost(candidate, baseline, spacing),
    };
  };

  const initialEvaluation = evaluate(baseline);
  if (initialEvaluation.crossings === 0 || ids.length < 2) {
    return resultSnapshot(baseline, initialEvaluation, initialEvaluation, evaluations, 0, false);
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

    const step = baseStep * Math.pow(0.68, pass);
    let best = null;
    const consider = (candidate, tag) => {
      if (evaluations >= maxEvaluations) return;
      const candidateEvaluation = evaluate(candidate);
      if (!isBetter(candidateEvaluation, currentEvaluation)) return;
      if (!best || isBetter(candidateEvaluation, best.evaluation)) {
        best = { positions: candidate, evaluation: candidateEvaluation, tag };
      }
    };

    for (let leftIndex = 0; leftIndex < hotIds.length && evaluations < maxEvaluations; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < hotIds.length && evaluations < maxEvaluations; rightIndex += 1) {
        const leftId = hotIds[leftIndex];
        const rightId = hotIds[rightIndex];
        const candidate = clonePositions(current);
        candidate[leftId] = { ...current[rightId] };
        candidate[rightId] = { ...current[leftId] };
        consider(candidate, `swap:${leftId}:${rightId}`);
      }
    }

    const neighbors = neighborMap(currentEvaluation.paths);
    for (const id of hotIds) {
      if (evaluations >= maxEvaluations) break;
      const origin = current[id];
      const localTargets = LOCAL_DIRECTIONS.map((direction) => ({
        x: origin.x + direction.x * step,
        y: origin.y + direction.y * step,
      }));
      const barycenter = neighborBarycenter(id, neighbors, current);
      if (barycenter) localTargets.push(stepTowards(origin, barycenter, step));

      for (const target of localTargets) {
        if (evaluations >= maxEvaluations) break;
        if (!withinMaximumDisplacement(target, baseline[id], maximumDisplacement)) continue;
        if (!preservesSpacing(id, target, current, baseline, minimumSpacing)) continue;
        const candidate = clonePositions(current);
        candidate[id] = target;
        consider(candidate, `move:${id}`);
      }
    }

    if (!best) continue;
    current = best.positions;
    currentEvaluation = best.evaluation;
    if (currentEvaluation.crossings === 0) break;
  }

  if (currentEvaluation.crossings >= initialEvaluation.crossings) {
    return resultSnapshot(baseline, initialEvaluation, initialEvaluation, evaluations, passesUsed, false);
  }

  return resultSnapshot(
    current,
    initialEvaluation,
    currentEvaluation,
    evaluations,
    passesUsed,
    !samePositions(baseline, current),
  );
}

function resultSnapshot(positions, before, after, evaluations, passes, changed) {
  return {
    positions: clonePositions(positions),
    crossingsBefore: before.crossings,
    crossingsAfter: after.crossings,
    changed,
    evaluations,
    passes,
  };
}

function isBetter(candidate, current) {
  if (candidate.crossings !== current.crossings) return candidate.crossings < current.crossings;
  return candidate.secondary < current.secondary - EPSILON;
}

function clonePositions(positions = {}) {
  const result = {};
  for (const id of Object.keys(positions).sort()) {
    const position = positions[id];
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) continue;
    result[id] = { x: position.x, y: position.y };
  }
  return result;
}

function samePositions(left, right) {
  const ids = Object.keys(left);
  if (ids.length !== Object.keys(right).length) return false;
  return ids.every((id) => Math.abs(left[id].x - right[id]?.x) <= EPSILON
    && Math.abs(left[id].y - right[id]?.y) <= EPSILON);
}

function totalPathLength(paths) {
  let total = 0;
  for (const path of paths) {
    for (let index = 1; index < path.points.length; index += 1) {
      total += distance(path.points[index - 1], path.points[index]);
    }
  }
  return total;
}

function displacementCost(positions, baseline, spacing) {
  let total = 0;
  for (const [id, position] of Object.entries(positions)) {
    const origin = baseline[id];
    if (!origin) continue;
    const dx = position.x - origin.x;
    const dy = position.y - origin.y;
    total += (dx * dx + dy * dy) / Math.max(spacing, 1);
  }
  return total;
}

function medianNearestSpacing(positions, ids) {
  if (ids.length < 2) return 80;
  const nearest = [];
  for (const id of ids) {
    let best = Number.POSITIVE_INFINITY;
    for (const otherId of ids) {
      if (id === otherId) continue;
      best = Math.min(best, distance(positions[id], positions[otherId]));
    }
    if (Number.isFinite(best) && best > EPSILON) nearest.push(best);
  }
  if (nearest.length === 0) return 80;
  nearest.sort((left, right) => left - right);
  return nearest[Math.floor(nearest.length / 2)];
}

function preservesSpacing(id, target, current, baseline, minimumSpacing) {
  for (const [otherId, other] of Object.entries(current)) {
    if (otherId === id) continue;
    const allowed = Math.min(minimumSpacing, distance(baseline[id], baseline[otherId]));
    if (distance(target, other) + EPSILON < allowed) return false;
  }
  return true;
}

function withinMaximumDisplacement(candidate, baseline, maximum) {
  return distance(candidate, baseline) <= maximum + EPSILON;
}

function neighborMap(paths) {
  const map = new Map();
  for (const path of paths) {
    if (!path.source || !path.target || path.source === path.target) continue;
    if (!map.has(path.source)) map.set(path.source, new Set());
    if (!map.has(path.target)) map.set(path.target, new Set());
    map.get(path.source).add(path.target);
    map.get(path.target).add(path.source);
  }
  return map;
}

function neighborBarycenter(id, neighbors, positions) {
  const ids = [...(neighbors.get(id) ?? [])].sort();
  if (ids.length === 0) return null;
  let x = 0;
  let y = 0;
  let count = 0;
  for (const neighborId of ids) {
    const position = positions[neighborId];
    if (!position) continue;
    x += position.x;
    y += position.y;
    count += 1;
  }
  return count === 0 ? null : { x: x / count, y: y / count };
}

function stepTowards(origin, target, maximumStep) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length <= maximumStep || length <= EPSILON) return { ...target };
  return {
    x: origin.x + dx / length * maximumStep,
    y: origin.y + dy / length * maximumStep,
  };
}

function shareSemanticEndpoint(left, right) {
  const leftIds = new Set([left.source, left.target].filter(Boolean));
  return [right.source, right.target].some((id) => id && leftIds.has(id));
}

function pathsProperlyIntersect(left, right) {
  for (let leftIndex = 1; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex < right.length; rightIndex += 1) {
      if (properSegmentsIntersect(
        left[leftIndex - 1],
        left[leftIndex],
        right[rightIndex - 1],
        right[rightIndex],
      )) return true;
    }
  }
  return false;
}

function pathBounds(points) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(left, right) {
  return left.minX <= right.maxX + EPSILON
    && left.maxX + EPSILON >= right.minX
    && left.minY <= right.maxY + EPSILON
    && left.maxY + EPSILON >= right.minY;
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function oppositeSigns(left, right) {
  return (left > EPSILON && right < -EPSILON) || (left < -EPSILON && right > EPSILON);
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
