import {
  addVec3,
  dotVec3,
  isFiniteVec3,
  normVec3,
  scaleVec3,
  subtractVec3,
} from "./geometry3d.js";

const EPSILON = 1e-12;
const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });

export const DEFAULT_READABILITY3D_OPTIONS = Object.freeze({
  minimumCenterDistance: 0.42,
  minimumCurveCenterDistance: 0.24,
  minimumCurveCurveDistance: 0.16,
  maxPasses: 6,
  correctionFraction: 0.65,
  maxCorrectionPerPass: 0.18,
  maxEnergyIncreaseRatio: 0.12,
  maxCenterPairEvaluations: 44850,
  maxCurveCenterEvaluations: 120000,
  maxCurveCurveEvaluations: 160000,
});

export const DEFAULT_LOD3D_OPTIONS = Object.freeze({
  nearDistance: 8,
  farDistance: 20,
  full: Object.freeze({ samplesPerTurn: 8, nodeSegments: 16, showLabel: true }),
  mid: Object.freeze({ samplesPerTurn: 4, nodeSegments: 12, showLabel: false }),
  far: Object.freeze({ samplesPerTurn: 2, nodeSegments: 8, showLabel: false }),
});

export const DEFAULT_3D_BUDGETS = Object.freeze({
  maxVisibleLinks: 300,
  maxSemanticArcs: 600,
  maxArcVertices: 180000,
  maxSceneObjects: 1500,
  maxReadabilityEvaluations: 325000,
});

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function boundedUnit(value, fallback) {
  return Math.max(0, Math.min(1, finiteNonNegative(value, fallback)));
}

function integerBudget(value, fallback) {
  return Math.max(0, Math.floor(finiteNonNegative(value, fallback)));
}

export function normalizeReadability3dOptions(options = {}) {
  const defaults = DEFAULT_READABILITY3D_OPTIONS;
  return {
    minimumCenterDistance: finitePositive(options.minimumCenterDistance, defaults.minimumCenterDistance),
    minimumCurveCenterDistance: finitePositive(
      options.minimumCurveCenterDistance,
      defaults.minimumCurveCenterDistance,
    ),
    minimumCurveCurveDistance: finitePositive(
      options.minimumCurveCurveDistance,
      defaults.minimumCurveCurveDistance,
    ),
    maxPasses: integerBudget(options.maxPasses, defaults.maxPasses),
    correctionFraction: boundedUnit(options.correctionFraction, defaults.correctionFraction),
    maxCorrectionPerPass: finitePositive(options.maxCorrectionPerPass, defaults.maxCorrectionPerPass),
    maxEnergyIncreaseRatio: finiteNonNegative(
      options.maxEnergyIncreaseRatio,
      defaults.maxEnergyIncreaseRatio,
    ),
    maxCenterPairEvaluations: integerBudget(
      options.maxCenterPairEvaluations,
      defaults.maxCenterPairEvaluations,
    ),
    maxCurveCenterEvaluations: integerBudget(
      options.maxCurveCenterEvaluations,
      defaults.maxCurveCenterEvaluations,
    ),
    maxCurveCurveEvaluations: integerBudget(
      options.maxCurveCurveEvaluations,
      defaults.maxCurveCurveEvaluations,
    ),
  };
}

function cloneVec3(point) {
  return {
    x: Number(point?.x ?? 0),
    y: Number(point?.y ?? 0),
    z: Number(point?.z ?? 0),
  };
}

function clonePositions(positions) {
  return Object.fromEntries(
    Object.entries(positions ?? {}).map(([id, position]) => [id, cloneVec3(position)]),
  );
}

function stableIds(positions) {
  return Object.keys(positions ?? {}).sort((left, right) =>
    left.localeCompare(right, "en", { numeric: true, sensitivity: "variant" }));
}

function stableAxis(leftId, rightId) {
  const text = `${leftId}\u0000${rightId}`;
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const axis = hash % 3;
  const sign = (hash & 4) === 0 ? 1 : -1;
  if (axis === 0) return { x: sign, y: 0, z: 0 };
  if (axis === 1) return { x: 0, y: sign, z: 0 };
  return { x: 0, y: 0, z: sign };
}

function normalizedDirection(fromId, toId, from, to) {
  const delta = subtractVec3(to, from);
  const distance = normVec3(delta);
  if (Number.isFinite(distance) && distance > EPSILON) {
    return { direction: scaleVec3(delta, 1 / distance), distance };
  }
  return { direction: stableAxis(fromId, toId), distance: 0 };
}

function pointSegmentClosest(point, start, end) {
  const segment = subtractVec3(end, start);
  const lengthSquared = dotVec3(segment, segment);
  if (!(lengthSquared > EPSILON)) {
    const delta = subtractVec3(point, start);
    return { point: cloneVec3(start), distance: normVec3(delta), t: 0 };
  }
  const t = Math.max(0, Math.min(1, dotVec3(subtractVec3(point, start), segment) / lengthSquared));
  const closest = addVec3(start, scaleVec3(segment, t));
  return { point: closest, distance: normVec3(subtractVec3(point, closest)), t };
}

// Closest distance for finite 3D segments, based on the standard clamped line-line solution.
function segmentSegmentClosest(p1, q1, p2, q2) {
  const d1 = subtractVec3(q1, p1);
  const d2 = subtractVec3(q2, p2);
  const r = subtractVec3(p1, p2);
  const a = dotVec3(d1, d1);
  const e = dotVec3(d2, d2);
  const f = dotVec3(d2, r);
  let s;
  let t;

  if (a <= EPSILON && e <= EPSILON) {
    return { left: cloneVec3(p1), right: cloneVec3(p2), distance: normVec3(r) };
  }
  if (a <= EPSILON) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = dotVec3(d1, r);
    if (e <= EPSILON) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = dotVec3(d1, d2);
      const denominator = a * e - b * b;
      s = denominator !== 0
        ? Math.max(0, Math.min(1, (b * f - c * e) / denominator))
        : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }

  const left = addVec3(p1, scaleVec3(d1, s));
  const right = addVec3(p2, scaleVec3(d2, t));
  return { left, right, distance: normVec3(subtractVec3(left, right)) };
}

function emptyMetric() {
  return {
    evaluations: 0,
    violations: 0,
    minimumObservedDistance: null,
    penalty: 0,
    truncated: false,
  };
}

function recordDistance(metric, distance, threshold) {
  if (!Number.isFinite(distance)) return;
  metric.minimumObservedDistance = metric.minimumObservedDistance == null
    ? distance
    : Math.min(metric.minimumObservedDistance, distance);
  if (distance < threshold) {
    const deficit = threshold - distance;
    metric.violations += 1;
    metric.penalty += deficit * deficit;
  }
}

function segmentsForArc(arc) {
  const points = Array.isArray(arc?.points) ? arc.points : [];
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (isFiniteVec3(start) && isFiniteVec3(end)) segments.push({ start, end });
  }
  return segments;
}

function sharesSemanticEndpoint(left, right) {
  const endpoints = new Set([left.semanticSource, left.semanticTarget]);
  return endpoints.has(right.semanticSource) || endpoints.has(right.semanticTarget);
}

export function auditReadability3d(positions, sceneData = null, options = {}) {
  const normalized = normalizeReadability3dOptions(options);
  const ids = stableIds(positions);
  const centers = emptyMetric();
  const curveCenter = emptyMetric();
  const curveCurve = emptyMetric();

  outerCenters:
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      if (centers.evaluations >= normalized.maxCenterPairEvaluations) {
        centers.truncated = true;
        break outerCenters;
      }
      centers.evaluations += 1;
      recordDistance(
        centers,
        normVec3(subtractVec3(positions[ids[left]], positions[ids[right]])),
        normalized.minimumCenterDistance,
      );
    }
  }

  const arcs = Array.isArray(sceneData?.arcs) ? sceneData.arcs : [];
  const arcSegments = arcs.map((arc) => ({ arc, segments: segmentsForArc(arc) }));

  outerCurveCenter:
  for (const { arc, segments } of arcSegments) {
    const excluded = new Set([arc.semanticSource, arc.semanticTarget]);
    for (const id of ids) {
      if (excluded.has(id)) continue;
      for (const segment of segments) {
        if (curveCenter.evaluations >= normalized.maxCurveCenterEvaluations) {
          curveCenter.truncated = true;
          break outerCurveCenter;
        }
        curveCenter.evaluations += 1;
        const closest = pointSegmentClosest(positions[id], segment.start, segment.end);
        recordDistance(curveCenter, closest.distance, normalized.minimumCurveCenterDistance);
      }
    }
  }

  outerCurveCurve:
  for (let left = 0; left < arcSegments.length; left += 1) {
    const leftEntry = arcSegments[left];
    for (let right = left + 1; right < arcSegments.length; right += 1) {
      const rightEntry = arcSegments[right];
      if (sharesSemanticEndpoint(leftEntry.arc, rightEntry.arc)) continue;
      for (const leftSegment of leftEntry.segments) {
        for (const rightSegment of rightEntry.segments) {
          if (curveCurve.evaluations >= normalized.maxCurveCurveEvaluations) {
            curveCurve.truncated = true;
            break outerCurveCurve;
          }
          curveCurve.evaluations += 1;
          const closest = segmentSegmentClosest(
            leftSegment.start,
            leftSegment.end,
            rightSegment.start,
            rightSegment.end,
          );
          recordDistance(curveCurve, closest.distance, normalized.minimumCurveCurveDistance);
        }
      }
    }
  }

  const penalty = centers.penalty + curveCenter.penalty + curveCurve.penalty;
  return {
    centers,
    curveCenter,
    curveCurve,
    penalty,
    evaluations: centers.evaluations + curveCenter.evaluations + curveCurve.evaluations,
    truncated: centers.truncated || curveCenter.truncated || curveCurve.truncated,
    allFinite: ids.every((id) => isFiniteVec3(positions[id])) && Number.isFinite(penalty),
  };
}

function centerSeparationPass(positions, rootId, normalized) {
  const ids = stableIds(positions);
  const corrections = Object.fromEntries(ids.map((id) => [id, cloneVec3(ZERO)]));
  let violations = 0;
  let evaluations = 0;

  outer:
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      if (evaluations >= normalized.maxCenterPairEvaluations) break outer;
      evaluations += 1;
      const leftId = ids[left];
      const rightId = ids[right];
      const pair = normalizedDirection(leftId, rightId, positions[leftId], positions[rightId]);
      if (pair.distance >= normalized.minimumCenterDistance) continue;
      violations += 1;
      const deficit = normalized.minimumCenterDistance - pair.distance;
      const correction = Math.min(
        normalized.maxCorrectionPerPass,
        deficit * normalized.correctionFraction,
      );
      const leftFixed = leftId === rootId;
      const rightFixed = rightId === rootId;
      if (leftFixed && rightFixed) continue;
      if (leftFixed) {
        corrections[rightId] = addVec3(corrections[rightId], scaleVec3(pair.direction, correction));
      } else if (rightFixed) {
        corrections[leftId] = addVec3(corrections[leftId], scaleVec3(pair.direction, -correction));
      } else {
        const half = correction / 2;
        corrections[leftId] = addVec3(corrections[leftId], scaleVec3(pair.direction, -half));
        corrections[rightId] = addVec3(corrections[rightId], scaleVec3(pair.direction, half));
      }
    }
  }

  const next = clonePositions(positions);
  for (const id of ids) {
    if (id === rootId) {
      next[id] = cloneVec3(ZERO);
      continue;
    }
    let correction = corrections[id];
    const magnitude = normVec3(correction);
    if (magnitude > normalized.maxCorrectionPerPass && magnitude > EPSILON) {
      correction = scaleVec3(correction, normalized.maxCorrectionPerPass / magnitude);
    }
    next[id] = addVec3(next[id], correction);
  }
  if (rootId != null && rootId in next) next[rootId] = cloneVec3(ZERO);
  return { positions: next, violations, evaluations };
}

function energyValue(energyEvaluator, positions) {
  if (typeof energyEvaluator !== "function") return null;
  const result = energyEvaluator(positions);
  const value = typeof result === "number" ? result : result?.total;
  return Number.isFinite(value) ? value : null;
}

export function optimizeReadability3d({
  positions,
  rootId = null,
  sceneBuilder = null,
  energyEvaluator = null,
} = {}, options = {}) {
  const normalized = normalizeReadability3dOptions(options);
  const initialPositions = clonePositions(positions);
  if (rootId != null && rootId in initialPositions) initialPositions[rootId] = cloneVec3(ZERO);
  const initialEnergy = energyValue(energyEvaluator, initialPositions);
  let current = initialPositions;
  let passes = 0;
  let centerEvaluations = 0;
  let rejectedByEnergy = false;

  for (let pass = 0; pass < normalized.maxPasses; pass += 1) {
    const result = centerSeparationPass(current, rootId, normalized);
    centerEvaluations += result.evaluations;
    if (result.violations === 0) break;

    const nextEnergy = energyValue(energyEvaluator, result.positions);
    if (initialEnergy != null && nextEnergy != null) {
      const allowed = initialEnergy + Math.max(EPSILON, Math.abs(initialEnergy))
        * normalized.maxEnergyIncreaseRatio;
      if (nextEnergy > allowed) {
        rejectedByEnergy = true;
        break;
      }
    }
    current = result.positions;
    passes += 1;
  }

  const sceneData = typeof sceneBuilder === "function" ? sceneBuilder(current) : null;
  const audit = auditReadability3d(current, sceneData, normalized);
  const finalEnergy = energyValue(energyEvaluator, current);
  return {
    positions: clonePositions(current),
    audit,
    metrics: {
      passes,
      centerEvaluations,
      rejectedByEnergy,
      initialEnergy,
      finalEnergy,
      energyDelta: initialEnergy != null && finalEnergy != null ? finalEnergy - initialEnergy : null,
      rootFixed: rootId == null || !(rootId in current)
        || (current[rootId].x === 0 && current[rootId].y === 0 && current[rootId].z === 0),
      allFinite: Object.values(current).every(isFiniteVec3),
    },
  };
}

export function normalizeLod3dOptions(options = {}) {
  const defaults = DEFAULT_LOD3D_OPTIONS;
  const nearDistance = finitePositive(options.nearDistance, defaults.nearDistance);
  const farDistance = Math.max(
    nearDistance,
    finitePositive(options.farDistance, defaults.farDistance),
  );
  const profile = (name) => ({
    samplesPerTurn: Math.max(1, Math.floor(finitePositive(
      options[name]?.samplesPerTurn,
      defaults[name].samplesPerTurn,
    ))),
    nodeSegments: Math.max(6, Math.floor(finitePositive(
      options[name]?.nodeSegments,
      defaults[name].nodeSegments,
    ))),
    showLabel: options[name]?.showLabel ?? defaults[name].showLabel,
  });
  return {
    nearDistance,
    farDistance,
    full: profile("full"),
    mid: profile("mid"),
    far: profile("far"),
  };
}

export function chooseLod3d({
  distance = Infinity,
  root = false,
  selected = false,
  current = false,
} = {}, options = {}) {
  const normalized = normalizeLod3dOptions(options);
  if (root || selected || current) return "full";
  const finiteDistance = Number.isFinite(distance) ? Math.max(0, distance) : Infinity;
  if (finiteDistance <= normalized.nearDistance) return "full";
  if (finiteDistance <= normalized.farDistance) return "mid";
  return "far";
}

export function buildLodPlan3d(sceneData, presentationState = null, distancesByLinkId = {}, options = {}) {
  const normalized = normalizeLod3dOptions(options);
  const presentationById = new Map(
    (presentationState?.nodes ?? []).map((node) => [node.linkId, node]),
  );
  const nodes = (sceneData?.nodes ?? []).map((node) => {
    const presentation = presentationById.get(node.linkId) ?? {};
    const tier = chooseLod3d({
      distance: distancesByLinkId[node.linkId],
      root: node.root,
      selected: presentation.selected,
      current: presentation.current,
    }, normalized);
    return {
      linkId: node.linkId,
      tier,
      ...normalized[tier],
      semanticColor: node.color,
    };
  });
  const nodeTier = new Map(nodes.map((node) => [node.linkId, node.tier]));
  const tierRank = { full: 0, mid: 1, far: 2 };
  const arcs = (sceneData?.arcs ?? []).map((arc) => {
    const sourceTier = nodeTier.get(arc.semanticSource) ?? "far";
    const targetTier = nodeTier.get(arc.semanticTarget) ?? "far";
    const tier = tierRank[sourceTier] <= tierRank[targetTier] ? sourceTier : targetTier;
    return {
      arcId: arc.arcId,
      linkId: arc.linkId,
      self: arc.self,
      tier,
      samplesPerTurn: normalized[tier].samplesPerTurn,
      colorFrom: arc.colorFrom,
      colorTo: arc.colorTo,
      visible: true,
    };
  });
  return { nodes, arcs };
}

function normalizeBudgets(budgets = {}) {
  const defaults = DEFAULT_3D_BUDGETS;
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, integerBudget(budgets[key], defaults[key])]),
  );
}

export function buildPerformanceBudget3d({
  visualModel,
  physicalState,
  sceneData,
  readabilityAudit = null,
} = {}, budgets = {}) {
  const limits = normalizeBudgets(budgets);
  const visibleLinks = visualModel?.nodes?.length ?? 0;
  const semanticArcs = visualModel?.arcs?.length ?? 0;
  const arcVertices = (sceneData?.arcs ?? []).reduce(
    (sum, arc) => sum + (arc.points?.length ?? 0),
    0,
  );
  const endArrows = (sceneData?.arcs ?? []).filter((arc) => arc.arrow === "target").length;
  const rootHalos = (sceneData?.nodes ?? []).filter((node) => node.root).length;
  const sceneObjects = (sceneData?.nodes?.length ?? 0)
    + (sceneData?.arcs?.length ?? 0)
    + endArrows
    + rootHalos;
  const readabilityEvaluations = readabilityAudit?.evaluations ?? 0;
  const iterations = physicalState?.metrics?.iterations ?? 0;
  const physicsEvaluations = physicalState?.metrics?.evaluations ?? {};
  const chargePairLimitPerIteration = visibleLinks * Math.max(0, visibleLinks - 1) / 2;

  const observed = {
    visibleLinks,
    semanticArcs,
    arcVertices,
    sceneObjects,
    readabilityEvaluations,
    solverIterations: iterations,
    springEvaluations: physicsEvaluations.springs ?? 0,
    chargePairEvaluations: physicsEvaluations.chargePairs ?? 0,
    chargePairLimitPerIteration,
  };
  const violations = [];
  if (visibleLinks > limits.maxVisibleLinks) violations.push("visibleLinks");
  if (semanticArcs > limits.maxSemanticArcs) violations.push("semanticArcs");
  if (arcVertices > limits.maxArcVertices) violations.push("arcVertices");
  if (sceneObjects > limits.maxSceneObjects) violations.push("sceneObjects");
  if (readabilityEvaluations > limits.maxReadabilityEvaluations) violations.push("readabilityEvaluations");

  return {
    limits,
    observed,
    violations,
    withinBudget: violations.length === 0,
  };
}

function rectanglesOverlap(left, right) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

export function screenSpaceDiagnostics3d({ nodes = [], labels = [] } = {}) {
  let projectedNodeOverlaps = 0;
  let importantNodeOverlaps = 0;
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const a = nodes[left];
      const b = nodes[right];
      const dx = Number(a.x) - Number(b.x);
      const dy = Number(a.y) - Number(b.y);
      const threshold = finiteNonNegative(a.radius, 0) + finiteNonNegative(b.radius, 0);
      if (dx * dx + dy * dy < threshold * threshold) {
        projectedNodeOverlaps += 1;
        if (a.selected || a.current || b.selected || b.current) importantNodeOverlaps += 1;
      }
    }
  }

  let labelOverlaps = 0;
  for (let left = 0; left < labels.length; left += 1) {
    for (let right = left + 1; right < labels.length; right += 1) {
      if (rectanglesOverlap(labels[left], labels[right])) labelOverlaps += 1;
    }
  }
  return { projectedNodeOverlaps, importantNodeOverlaps, labelOverlaps };
}
