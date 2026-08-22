// Presentation-only geometry adapted from konard/links-visuals.
// Upstream snapshot is pinned so the visual origin of the algorithm is auditable.

export const BLUEPRINT_UPSTREAM = Object.freeze({
  repository: "konard/links-visuals",
  commit: "f377441533e4f10fa94aaa07138b684df88234b1",
  license: "Unlicense",
  references: Object.freeze([
    "animated-blueprint.html",
    "js/path.mjs",
    "js/ik-pure.mjs",
    "js/blueprint-link.mjs",
    "grid.html",
    "docs/case-studies/issue-28/README.md",
  ]),
});

export const DEFAULT_BLUEPRINT_OPTIONS = Object.freeze({
  spacing: 96,
  startOffsetFraction: 0.10,
  endOffsetFraction: 0.16,
  sideToleranceFraction: 0.001,
});

const IK_SEG_COUNT = 4;
const IK_FIRST_MAX_DELTA = Math.PI / 2;
const IK_SWEEP_STEPS = 300;
const EPSILON = 1e-9;

export function createBlueprintInitialPositions(visualModel, options = {}) {
  const spacing = finitePositive(options.spacing, DEFAULT_BLUEPRINT_OPTIONS.spacing);
  const nodes = Array.isArray(visualModel?.nodes) ? visualModel.nodes : [];
  const rootId = visualModel?.rootId ?? null;
  const ordered = rootId
    ? [...nodes.filter((node) => node.linkId === rootId), ...nodes.filter((node) => node.linkId !== rootId)]
    : [...nodes];
  const positions = {};

  ordered.forEach((node, index) => {
    const cell = squareSpiralCell(index);
    positions[node.linkId] = { x: cell.x * spacing, y: cell.y * spacing };
  });
  return positions;
}

export function buildBlueprintGeometry(visualModel, positions = null, options = {}) {
  const spacing = finitePositive(options.spacing, DEFAULT_BLUEPRINT_OPTIONS.spacing);
  const startOffsetFraction = finiteNonNegative(
    options.startOffsetFraction,
    DEFAULT_BLUEPRINT_OPTIONS.startOffsetFraction,
  );
  const endOffsetFraction = finiteNonNegative(
    options.endOffsetFraction,
    DEFAULT_BLUEPRINT_OPTIONS.endOffsetFraction,
  );
  const sideTolerance = finiteNonNegative(
    options.sideToleranceFraction,
    DEFAULT_BLUEPRINT_OPTIONS.sideToleranceFraction,
  ) * spacing;
  const resolvedPositions = normalizePositions(
    visualModel,
    positions ?? createBlueprintInitialPositions(visualModel, { spacing }),
  );
  const nodes = Array.isArray(visualModel?.nodes) ? visualModel.nodes : [];

  return {
    upstream: BLUEPRINT_UPSTREAM,
    spacing,
    positions: resolvedPositions,
    links: nodes.map((node) => buildLinkGeometry(node, resolvedPositions, {
      spacing,
      startOffsetFraction,
      endOffsetFraction,
      sideTolerance,
    })),
  };
}

export function blueprintGeometryIsFinite(geometry) {
  if (!geometry || !Array.isArray(geometry.links)) return false;
  return geometry.links.every((link) => [
    link.center,
    link.startAnchor,
    link.endAnchor,
    ...link.points,
    ...link.pathPoints,
    ...link.segments.flatMap((segment) => [segment.from, segment.control1, segment.control2, segment.to]),
  ].every(pointIsFinite));
}

export function blueprintCubicSegmentDerivativeAtStart(segment) {
  if (!segment || !pointIsFinite(segment.from) || !pointIsFinite(segment.control1)) return null;
  return scale(subtract(segment.control1, segment.from), 3);
}

export function blueprintCubicSegmentDerivativeAtEnd(segment) {
  if (!segment || !pointIsFinite(segment.to) || !pointIsFinite(segment.control2)) return null;
  return scale(subtract(segment.to, segment.control2), 3);
}

export function blueprintSegmentsAreC1(segments, epsilon = EPSILON) {
  if (!Array.isArray(segments)) return false;
  const tolerance = finiteNonNegative(epsilon, EPSILON);
  for (let index = 0; index < segments.length - 1; index += 1) {
    const left = segments[index];
    const right = segments[index + 1];
    if (!pointsNearlyEqual(left?.to, right?.from, tolerance)) return false;
    const leftDerivative = blueprintCubicSegmentDerivativeAtEnd(left);
    const rightDerivative = blueprintCubicSegmentDerivativeAtStart(right);
    if (!pointsNearlyEqual(leftDerivative, rightDerivative, tolerance)) return false;
  }
  return true;
}

function buildLinkGeometry(node, positions, options) {
  const center = clonePoint(positions[node.linkId]);
  const startAnchor = clonePoint(positions[node.startId] ?? center);
  const endAnchor = clonePoint(positions[node.endId] ?? center);
  const intermediate = computeIntermediatePoints(
    center,
    startAnchor,
    endAnchor,
    options.spacing,
    options.sideTolerance,
  );
  const points = [
    startAnchor,
    intermediate.p1,
    intermediate.p2,
    intermediate.p3,
    center,
    intermediate.p4,
    intermediate.p5,
    intermediate.p6,
    endAnchor,
  ];
  const pathPoints = applyEndpointOffsets(
    points,
    options.startOffsetFraction * options.spacing,
    options.endOffsetFraction * options.spacing,
  );
  const segments = cubicSegments(pathPoints);
  const path = segmentsToPath(segments);

  return {
    linkId: node.linkId,
    startId: node.startId,
    endId: node.endId,
    root: Boolean(node.root),
    label: node.label,
    center,
    startAnchor,
    endAnchor,
    points,
    pathPoints,
    segments,
    path,
    // Temporary compatibility for the pre-#96 renderer. The canonical geometry
    // is the single `path`; #96 removes the visual split at the semantic center.
    startPath: segmentsToPath(segments.slice(0, 4)),
    endPath: segmentsToPath(segments.slice(4)),
    selfStart: node.startId === node.linkId,
    selfEnd: node.endId === node.linkId,
  };
}

function normalizePositions(visualModel, positions) {
  const defaults = createBlueprintInitialPositions(visualModel);
  const result = {};
  for (const node of visualModel?.nodes ?? []) {
    const requested = positions?.[node.linkId];
    result[node.linkId] = pointIsFinite(requested)
      ? clonePoint(requested)
      : clonePoint(defaults[node.linkId] ?? { x: 0, y: 0 });
  }
  return result;
}

function computeIntermediatePoints(center, start, end, baseSegmentLength, sideTolerance) {
  const distanceToEnd = distance(center, end);
  const distanceToStart = distance(center, start);
  const rightSegmentLength = Math.max(baseSegmentLength, distanceToEnd / IK_SEG_COUNT);
  const leftSegmentLength = Math.max(baseSegmentLength, distanceToStart / IK_SEG_COUNT);
  const rightMaximumReach = IK_SEG_COUNT * rightSegmentLength;
  const leftMaximumReach = IK_SEG_COUNT * leftSegmentLength;
  const endDirection = distanceToEnd > EPSILON
    ? Math.atan2(end.y - center.y, end.x - center.x)
    : 0;
  const right = solveIK(
    center,
    end,
    0,
    rightSegmentLength,
    rightMaximumReach,
    sideTolerance,
    endDirection,
  );
  const firstRightDirection = Math.atan2(
    right.arc[1].y - center.y,
    right.arc[1].x - center.x,
  );
  const mirroredStart = {
    x: 2 * center.x - start.x,
    y: 2 * center.y - start.y,
  };
  const left = solveIK(
    center,
    mirroredStart,
    right.preferredSide,
    leftSegmentLength,
    leftMaximumReach,
    sideTolerance,
    firstRightDirection,
  );
  const leftArc = left.arc.map((point) => ({
    x: 2 * center.x - point.x,
    y: 2 * center.y - point.y,
  }));

  return {
    p1: leftArc[3],
    p2: leftArc[2],
    p3: leftArc[1],
    p4: right.arc[1],
    p5: right.arc[2],
    p6: right.arc[3],
  };
}

function solveIK(origin, target, preferredSide, segmentLength, maximumReach, sideTolerance, initialAngle) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const targetDistance = Math.hypot(dx, dy);
  let side = preferredSide || (dy < 0 ? 1 : -1);
  const effectiveDistance = Math.min(targetDistance, maximumReach);
  let low = 1e-6;
  let high = Math.PI * 2 / IK_SEG_COUNT - 1e-6;
  const span = (curvature) => Math.sin(IK_SEG_COUNT * curvature / 2) / Math.sin(curvature / 2);

  for (let iteration = 0; iteration < 40; iteration += 1) {
    const mid = (low + high) / 2;
    if (span(mid) > effectiveDistance / segmentLength) low = mid;
    else high = mid;
  }
  const curvature = (low + high) / 2;
  let positive;
  let negative;

  if (targetDistance < maximumReach - 1e-3) {
    positive = candidateTowardTarget(curvature, 1, dx, dy, origin, target, segmentLength, initialAngle, targetDistance < maximumReach * 0.82);
    negative = candidateTowardTarget(curvature, -1, dx, dy, origin, target, segmentLength, initialAngle, targetDistance < maximumReach * 0.82);
  } else {
    positive = findBestArc(1, initialAngle, origin, target, segmentLength);
    negative = findBestArc(-1, initialAngle, origin, target, segmentLength);
  }

  const current = side > 0 ? positive : negative;
  const opposite = side > 0 ? negative : positive;
  if (opposite.distance < current.distance - sideTolerance) side *= -1;
  return { arc: side > 0 ? positive.arc : negative.arc, preferredSide: side };
}

function candidateTowardTarget(curvature, side, dx, dy, origin, target, segmentLength, initialAngle, closeRange) {
  const turn = curvature * side;
  const baseDirection = Math.atan2(dy, dx) - (IK_SEG_COUNT - 1) * turn / 2;
  const arc = buildArc(curvature, side, baseDirection, origin, segmentLength);
  clampFirstJoint(arc, origin, closeRange ? IK_FIRST_MAX_DELTA / 2 : IK_FIRST_MAX_DELTA, initialAngle);
  return { arc, distance: distance(arc[IK_SEG_COUNT], target) };
}

function findBestArc(side, baseDirection, origin, target, segmentLength) {
  let bestArc = null;
  let bestDistance = Infinity;
  const maxCurvature = Math.PI * 2 / IK_SEG_COUNT - 1e-4;
  for (let step = 0; step <= IK_SWEEP_STEPS; step += 1) {
    const curvature = step * maxCurvature / IK_SWEEP_STEPS;
    const arc = buildArc(curvature, side, baseDirection, origin, segmentLength);
    const candidateDistance = distance(arc[IK_SEG_COUNT], target);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestArc = arc;
    }
  }
  clampFirstJoint(bestArc, origin, IK_FIRST_MAX_DELTA, baseDirection);
  return { arc: bestArc, distance: bestDistance };
}

function buildArc(curvature, side, baseDirection, origin, segmentLength) {
  const points = [clonePoint(origin)];
  let direction = baseDirection;
  let x = origin.x;
  let y = origin.y;
  for (let index = 1; index <= IK_SEG_COUNT; index += 1) {
    x += segmentLength * Math.cos(direction);
    y += segmentLength * Math.sin(direction);
    points.push({ x, y });
    direction += curvature * side;
  }
  return points;
}

function clampFirstJoint(arc, origin, maxDelta, initialAngle) {
  const current = Math.atan2(arc[1].y - origin.y, arc[1].x - origin.x);
  const delta = normalizeAngle(current - initialAngle);
  if (delta > maxDelta) rotateAround(arc, origin, maxDelta - delta);
  else if (delta < -maxDelta) rotateAround(arc, origin, -maxDelta - delta);
}

function rotateAround(points, origin, angle) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  for (const point of points) {
    const x = point.x - origin.x;
    const y = point.y - origin.y;
    point.x = origin.x + x * cos - y * sin;
    point.y = origin.y + x * sin + y * cos;
  }
}

function applyEndpointOffsets(points, startOffset, endOffset) {
  const path = points.map(clonePoint);
  path[0] = offsetToward(path[0], path[1], startOffset);
  const last = path.length - 1;
  path[last] = offsetToward(path[last], path[last - 1], endOffset);
  return path;
}

function cubicSegments(points) {
  const tangents = points.map((point, index) => {
    if (index === 0) return subtract(points[1], points[0]);
    if (index === points.length - 1) return subtract(points[index], points[index - 1]);
    return scale(subtract(points[index + 1], points[index - 1]), 0.5);
  });
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push({
      from: clonePoint(points[index]),
      control1: add(points[index], scale(tangents[index], 1 / 3)),
      control2: subtract(points[index + 1], scale(tangents[index + 1], 1 / 3)),
      to: clonePoint(points[index + 1]),
    });
  }
  return segments;
}

function segmentsToPath(segments) {
  if (segments.length === 0) return "";
  let path = `M ${number(segments[0].from.x)} ${number(segments[0].from.y)}`;
  for (const segment of segments) {
    path += ` C ${number(segment.control1.x)} ${number(segment.control1.y)}, ${number(segment.control2.x)} ${number(segment.control2.y)}, ${number(segment.to.x)} ${number(segment.to.y)}`;
  }
  return path;
}

function squareSpiralCell(index) {
  if (index <= 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  let dx = 1;
  let dy = 0;
  let segmentLength = 1;
  let segmentProgress = 0;
  let turns = 0;
  for (let step = 0; step < index; step += 1) {
    x += dx;
    y += dy;
    segmentProgress += 1;
    if (segmentProgress === segmentLength) {
      segmentProgress = 0;
      [dx, dy] = [-dy, dx];
      turns += 1;
      if (turns % 2 === 0) segmentLength += 1;
    }
  }
  return { x, y };
}

function offsetToward(from, toward, offset) {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return clonePoint(from);
  const amount = Math.min(offset, length * 0.8);
  return { x: from.x + dx / length * amount, y: from.y + dy / length * amount };
}

function normalizeAngle(angle) {
  let result = angle;
  while (result > Math.PI) result -= 2 * Math.PI;
  while (result < -Math.PI) result += 2 * Math.PI;
  return result;
}

function add(left, right) {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left, right) {
  return { x: left.x - right.x, y: left.y - right.y };
}

function scale(point, factor) {
  return { x: point.x * factor, y: point.y * factor };
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clonePoint(point) {
  return { x: Number(point?.x ?? 0), y: Number(point?.y ?? 0) };
}

function pointIsFinite(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function pointsNearlyEqual(left, right, epsilon) {
  if (!pointIsFinite(left) || !pointIsFinite(right)) return false;
  const scaleX = Math.max(1, Math.abs(left.x), Math.abs(right.x));
  const scaleY = Math.max(1, Math.abs(left.y), Math.abs(right.y));
  return Math.abs(left.x - right.x) <= epsilon * scaleX
    && Math.abs(left.y - right.y) <= epsilon * scaleY;
}

function finitePositive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function number(value) {
  return Number(value.toFixed(6));
}