import {
  minimizeArcCrossings,
  sampleCubicBezier,
  sampleQuadraticBezier,
} from "./layout-postprocessor.js";
import { buildRootedStructuralLayout } from "./rooted-layout.js";
import { minimizeRootedArcCrossings } from "./rooted-crossing.js";
import {
  END_LOOP_SWEEP_DEG,
  START_LOOP_SWEEP_DEG,
  cytoscapeGraphStyle,
  visualModelToCytoscapeElements,
} from "./cytoscape-adapter.js";
import {
  buildVisualModel,
  normalizeVisualDebugState,
} from "./visual-model.js";

const graphStates = new WeakMap();
const ARC_TANGENT_LENGTH = 26;
const GEOMETRY_EPSILON = 1e-9;
const SELF_LOOP_NODE_RADIUS = 24;
const SELF_LOOP_CONTROL_RADIUS = 54;

export const ROOTED_LAYOUT_ID = "rooted";
export const GRAPH_LAYOUTS = Object.freeze([
  { id: ROOTED_LAYOUT_ID, title: "От акорня" },
  { id: "cose", title: "CoSE" },
  { id: "breadthfirst", title: "Дерево" },
  { id: "circle", title: "Круг" },
  { id: "grid", title: "Сетка" },
  { id: "concentric", title: "Концентрическая" },
]);

// Compatibility facade: прежняя базовая Cytoscape-проекция link -> pole
// теперь получается из renderer-independent visual model.
export function asetToGraphElements(aset, limit = 300) {
  return visualModelToCytoscapeElements(
    buildVisualModel(aset, limit),
    { legacyPoleOrientation: true },
  );
}

// Семантическая renderer-проекция: startPole -> link -> endPole.
export function graphElementsForRendering(aset, limit = 300) {
  return visualModelToCytoscapeElements(buildVisualModel(aset, limit));
}

// Две GREEN-касательные одной связи в её центре всегда антипараллельны.
export function pairedArcControlGeometry(center, startPole, endPole, tangentLength = ARC_TANGENT_LENGTH) {
  const startVector = subtract(startPole, center);
  const endVector = subtract(endPole, center);
  const startUnit = normalize(startVector);
  const endUnit = normalize(endVector);

  let outwardStart = normalize(subtract(startUnit, endUnit));
  if (!outwardStart) {
    const fallback = startUnit ?? scale(endUnit, -1) ?? { x: 1, y: 0 };
    outwardStart = normalize({ x: -fallback.y, y: fallback.x }) ?? { x: 1, y: 0 };
  }
  if (dot(outwardStart, startVector) < 0) outwardStart = scale(outwardStart, -1);

  const outwardEnd = scale(outwardStart, -1);
  const startControl = add(center, scale(outwardStart, tangentLength));
  const endControl = add(center, scale(outwardEnd, tangentLength));

  return {
    startControl,
    endControl,
    outwardStart,
    outwardEnd,
    startStyle: bezierControlStyle(startPole, center, startControl),
    endStyle: bezierControlStyle(center, endPole, endControl),
  };
}

export function cytoscapeLoopAngleForScreenVector(vector) {
  const unit = normalize(vector);
  if (!unit) return 0;
  return normalizeDegrees(Math.atan2(unit.x, -unit.y) * 180 / Math.PI);
}

export function semanticLoopGeometry(outward, semanticEndpoint, sweepDegrees) {
  if (semanticEndpoint !== "source" && semanticEndpoint !== "target") {
    throw new Error(`Неизвестный semantic endpoint self-loop: ${semanticEndpoint}`);
  }

  const semanticRayAngle = cytoscapeLoopAngleForScreenVector(outward);
  const halfSweep = sweepDegrees / 2;
  const loopDirection = semanticEndpoint === "source"
    ? normalizeDegrees(semanticRayAngle + halfSweep)
    : normalizeDegrees(semanticRayAngle - halfSweep);

  return {
    outward: normalize(outward) ?? { x: 1, y: 0 },
    semanticEndpoint,
    semanticRayAngle,
    loopDirection,
    loopSweep: sweepDegrees,
  };
}

export function semanticLoopRayAngle(loopDirection, semanticEndpoint, sweepDegrees) {
  const halfSweep = sweepDegrees / 2;
  return semanticEndpoint === "source"
    ? normalizeDegrees(loopDirection - halfSweep)
    : normalizeDegrees(loopDirection + halfSweep);
}

export function singleSelfLoopGeometry(center, companionPole, selfRole, tangentLength = ARC_TANGENT_LENGTH) {
  if (selfRole !== "start" && selfRole !== "end") {
    throw new Error(`Неизвестная роль self-loop: ${selfRole}`);
  }

  const companionOutward = normalize(subtract(companionPole, center)) ?? { x: 1, y: 0 };
  const selfOutward = scale(companionOutward, -1);
  const companionControl = add(center, scale(companionOutward, tangentLength));
  const isStartSelf = selfRole === "start";
  const loop = semanticLoopGeometry(
    selfOutward,
    isStartSelf ? "target" : "source",
    isStartSelf ? START_LOOP_SWEEP_DEG : END_LOOP_SWEEP_DEG,
  );

  return {
    companionOutward,
    selfOutward,
    companionControl,
    companionStyle: isStartSelf
      ? bezierControlStyle(center, companionPole, companionControl)
      : bezierControlStyle(companionPole, center, companionControl),
    loop,
  };
}

export function doubleSelfLoopGeometry() {
  const startOutward = { x: -1, y: 0 };
  const endOutward = { x: 1, y: 0 };
  return {
    startOutward,
    endOutward,
    startLoop: semanticLoopGeometry(startOutward, "target", START_LOOP_SWEEP_DEG),
    endLoop: semanticLoopGeometry(endOutward, "source", END_LOOP_SWEEP_DEG),
  };
}

// Полилинейное приближение именно отображаемых RGB-дуг. Это геометрия UI,
// а не дополнительная семантическая реализация МТС.
export function graphArcPaths(aset, positions, limit = 300, samples = 6) {
  if (!aset?.links?.length) return [];
  const links = aset.links.slice(0, limit);
  const visible = new Set(links.map((link) => link.id));
  const paths = [];

  for (const link of links) {
    const center = positions?.[link.id];
    if (!center) continue;
    const startPosition = visible.has(link.start) ? positions?.[link.start] : null;
    const endPosition = visible.has(link.end) ? positions?.[link.end] : null;
    const startSelf = link.start === link.id;
    const endSelf = link.end === link.id;

    if (startPosition && endPosition && !startSelf && !endSelf) {
      const geometry = pairedArcControlGeometry(center, startPosition, endPosition);
      paths.push({
        id: `pole-start:${link.id}`,
        source: link.start,
        target: link.id,
        points: sampleQuadraticBezier(startPosition, geometry.startControl, center, samples),
      });
      paths.push({
        id: `pole-end:${link.id}`,
        source: link.id,
        target: link.end,
        points: sampleQuadraticBezier(center, geometry.endControl, endPosition, samples),
      });
      continue;
    }

    if (startSelf && endSelf) {
      const geometry = doubleSelfLoopGeometry();
      paths.push(loopArcPath(`pole-start:${link.id}`, link.id, center, geometry.startLoop, samples));
      paths.push(loopArcPath(`pole-end:${link.id}`, link.id, center, geometry.endLoop, samples));
      continue;
    }

    if (startSelf && endPosition) {
      const geometry = singleSelfLoopGeometry(center, endPosition, "start");
      paths.push(loopArcPath(`pole-start:${link.id}`, link.id, center, geometry.loop, samples));
      paths.push({
        id: `pole-end:${link.id}`,
        source: link.id,
        target: link.end,
        points: sampleQuadraticBezier(center, geometry.companionControl, endPosition, samples),
      });
      continue;
    }

    if (endSelf && startPosition) {
      const geometry = singleSelfLoopGeometry(center, startPosition, "end");
      paths.push({
        id: `pole-start:${link.id}`,
        source: link.start,
        target: link.id,
        points: sampleQuadraticBezier(startPosition, geometry.companionControl, center, samples),
      });
      paths.push(loopArcPath(`pole-end:${link.id}`, link.id, center, geometry.loop, samples));
      continue;
    }

    if (startPosition && !startSelf) {
      paths.push({
        id: `pole-start:${link.id}`,
        source: link.start,
        target: link.id,
        points: [startPosition, center],
      });
    }
    if (endPosition && !endSelf) {
      paths.push({
        id: `pole-end:${link.id}`,
        source: link.id,
        target: link.end,
        points: [center, endPosition],
      });
    }
  }

  return paths;
}

export function optimizeAsetLayoutPositions(aset, positions, options = {}) {
  const profile = optimizationProfile(Math.min(aset?.links?.length ?? 0, 300));
  const samples = options.samples ?? profile.samples;

  return minimizeArcCrossings({
    positions,
    buildPaths: (candidate) => graphArcPaths(aset, candidate, 300, samples),
    fixedIds: [aset?.root].filter(Boolean),
    maxPasses: options.maxPasses ?? profile.maxPasses,
    maxHotNodes: options.maxHotNodes ?? profile.maxHotNodes,
    maxEvaluations: options.maxEvaluations ?? profile.maxEvaluations,
    displacementWeight: options.displacementWeight ?? 0.18,
  });
}

// Основной layout асети: depth определяет радиус, crossing minimizer — угол.
export function optimizeRootedAsetLayoutPositions(aset, seedPositions, options = {}) {
  const profile = optimizationProfile(Math.min(aset?.links?.length ?? 0, 300));
  const samples = options.samples ?? profile.samples;
  const structural = buildRootedStructuralLayout(aset, seedPositions, {
    layerSpacing: options.layerSpacing ?? 96,
    minimumNodeSpacing: options.minimumNodeSpacing ?? 58,
  });
  const optimized = minimizeRootedArcCrossings({
    positions: structural.positions,
    center: structural.center,
    projectPosition: structural.projectPosition,
    buildPaths: (candidate) => graphArcPaths(aset, candidate, 300, samples),
    fixedIds: [aset?.root].filter(Boolean),
    maxPasses: options.maxPasses ?? profile.maxPasses,
    maxHotNodes: options.maxHotNodes ?? Math.max(profile.maxHotNodes, 10),
    maxEvaluations: options.maxEvaluations ?? Math.max(profile.maxEvaluations, 160),
    minimumSpacing: options.minimumNodeSpacing ?? 44,
  });

  const visibleDepths = Object.keys(optimized.positions)
    .map((id) => structural.depths[id])
    .filter(Number.isInteger);
  return {
    ...optimized,
    changed: positionsDiffer(seedPositions, optimized.positions),
    center: structural.center,
    depths: structural.depths,
    radii: structural.radii,
    layerSpacing: structural.layerSpacing,
    maxDepth: visibleDepths.length > 0 ? Math.max(...visibleDepths) : 0,
  };
}

export function renderAset(container, aset, options = {}) {
  destroyGraph(container);
  if (!aset?.links?.length) {
    container.replaceChildren();
    return;
  }

  const cytoscape = requireCytoscape();
  const layoutId = options.layout ?? container.dataset.layout ?? ROOTED_LAYOUT_ID;
  container.dataset.layout = layoutId;
  const visualModel = buildVisualModel(aset);
  const elements = visualModelToCytoscapeElements(visualModel);
  const cy = cytoscape({
    container,
    elements,
    style: graphStyle(),
    layout: layoutOptions(layoutId),
    minZoom: 0.08,
    maxZoom: 8,
    wheelSensitivity: 2.2,
    userZoomingEnabled: true,
    userPanningEnabled: true,
    autoungrabify: false,
    boxSelectionEnabled: false,
  });

  let applyingPostprocess = false;
  let lastPostprocessedSignature = null;
  const alignArcs = () => alignPoleArcs(cy);
  const postprocessLayout = () => {
    if (applyingPostprocess) return;
    const positions = readCyPositions(cy);
    const inputSignature = positionSignature(positions);
    if (inputSignature === lastPostprocessedSignature) {
      alignArcs();
      return;
    }

    const activeLayoutId = container.dataset.layout ?? ROOTED_LAYOUT_ID;
    const rooted = activeLayoutId === ROOTED_LAYOUT_ID;
    const result = rooted
      ? optimizeRootedAsetLayoutPositions(aset, positions)
      : optimizeAsetLayoutPositions(aset, positions);

    applyingPostprocess = true;
    try {
      if (result.changed) applyCyPositions(cy, result.positions);
      if (rooted) applyStructuralDepthData(cy, result.depths);
      alignArcs();
      lastPostprocessedSignature = positionSignature(result.positions);
      container.dataset.crossingsBefore = String(result.crossingsBefore);
      container.dataset.crossingsAfter = String(result.crossingsAfter);
      if (rooted) {
        container.dataset.structuralMaxDepth = String(result.maxDepth);
        container.dataset.structuralLayerSpacing = result.layerSpacing.toFixed(3);
        cy.fit(undefined, 46);
      } else {
        delete container.dataset.structuralMaxDepth;
        delete container.dataset.structuralLayerSpacing;
      }
    } finally {
      applyingPostprocess = false;
    }
  };

  cy.on("layoutstop", postprocessLayout);
  cy.on("position", "node", () => {
    if (!applyingPostprocess) alignArcs();
  });
  cy.ready(() => queueMicrotask(postprocessLayout));

  const resizeObserver = new ResizeObserver(() => cy.resize());
  resizeObserver.observe(container);
  graphStates.set(container, { cy, resizeObserver, aset, visualModel });
}

export function changeGraphLayout(container, layoutId) {
  container.dataset.layout = layoutId;
  const state = graphStates.get(container);
  if (!state) return;
  state.cy.layout(layoutOptions(layoutId)).run();
}

export function fitGraph(container) {
  graphStates.get(container)?.cy.fit(undefined, 42);
}

export function zoomGraph(container, factor) {
  const cy = graphStates.get(container)?.cy;
  if (!cy) return;
  const next = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
  cy.zoom({
    level: next,
    renderedPosition: { x: container.clientWidth / 2, y: container.clientHeight / 2 },
  });
}

export function setGraphDebugState(container, debugState) {
  const state = graphStates.get(container);
  if (!state) return;

  const { cy, visualModel } = state;
  const normalized = normalizeVisualDebugState(visualModel, debugState);
  const visible = new Set(normalized.visibleLinkIds);
  const produced = new Set(normalized.producedLinks);
  const reused = new Set(normalized.reusedLinks);
  const current = normalized.current;

  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const linkId = node.data("linkId");
      node.toggleClass("debug-hidden", !visible.has(linkId));
      node.toggleClass("debug-produced", produced.has(linkId));
      node.toggleClass("debug-reused", reused.has(linkId));
      node.toggleClass("debug-current", linkId === current);
    });

    cy.edges().forEach((edge) => {
      const linkId = edge.data("linkId");
      edge.toggleClass("debug-hidden", !visible.has(linkId));
      edge.toggleClass("debug-produced", produced.has(linkId));
      edge.toggleClass("debug-reused", reused.has(linkId));
    });
  });
}

export function destroyGraph(container) {
  const state = graphStates.get(container);
  if (!state) return;
  state.resizeObserver.disconnect();
  state.cy.destroy();
  graphStates.delete(container);
}

function alignPoleArcs(cy) {
  cy.nodes().forEach((centerNode) => {
    const linkId = centerNode.data("linkId");
    if (!linkId) return;

    const startEdge = cy.getElementById(`pole-start:${linkId}`);
    const endEdge = cy.getElementById(`pole-end:${linkId}`);
    if (startEdge.empty() || endEdge.empty()) return;

    const startPole = startEdge.source();
    const endPole = endEdge.target();
    const centerPosition = centerNode.position();
    const startPosition = startPole.position();
    const endPosition = endPole.position();
    const startSelf = startPole.id() === centerNode.id();
    const endSelf = endPole.id() === centerNode.id();

    if (!startSelf && !endSelf) {
      const geometry = pairedArcControlGeometry(centerPosition, startPosition, endPosition);
      applyBezierGeometry(startEdge, geometry.startStyle);
      applyBezierGeometry(endEdge, geometry.endStyle);
      return;
    }

    if (startSelf && endSelf) {
      const geometry = doubleSelfLoopGeometry();
      applyLoopGeometry(startEdge, geometry.startLoop);
      applyLoopGeometry(endEdge, geometry.endLoop);
      return;
    }

    if (startSelf) {
      const geometry = singleSelfLoopGeometry(centerPosition, endPosition, "start");
      applyLoopGeometry(startEdge, geometry.loop);
      applyBezierGeometry(endEdge, geometry.companionStyle);
      return;
    }

    const geometry = singleSelfLoopGeometry(centerPosition, startPosition, "end");
    applyBezierGeometry(startEdge, geometry.companionStyle);
    applyLoopGeometry(endEdge, geometry.loop);
  });
}

function loopArcPath(id, linkId, center, geometry, samples) {
  const sourceAngle = normalizeDegrees(geometry.loopDirection - geometry.loopSweep / 2);
  const targetAngle = normalizeDegrees(geometry.loopDirection + geometry.loopSweep / 2);
  const sourceRay = screenVectorForCytoscapeAngle(sourceAngle);
  const targetRay = screenVectorForCytoscapeAngle(targetAngle);
  const source = add(center, scale(sourceRay, SELF_LOOP_NODE_RADIUS));
  const target = add(center, scale(targetRay, SELF_LOOP_NODE_RADIUS));
  const control1 = add(center, scale(sourceRay, SELF_LOOP_CONTROL_RADIUS));
  const control2 = add(center, scale(targetRay, SELF_LOOP_CONTROL_RADIUS));
  return {
    id,
    source: linkId,
    target: linkId,
    points: sampleCubicBezier(source, control1, control2, target, Math.max(samples, 5)),
  };
}

function screenVectorForCytoscapeAngle(angle) {
  const radians = angle * Math.PI / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}

function readCyPositions(cy) {
  const positions = {};
  cy.nodes().forEach((node) => {
    const position = node.position();
    positions[node.id()] = { x: position.x, y: position.y };
  });
  return positions;
}

function applyCyPositions(cy, positions) {
  cy.batch(() => {
    for (const [id, position] of Object.entries(positions)) {
      const node = cy.getElementById(id);
      if (!node.empty()) node.position(position);
    }
  });
}

function applyStructuralDepthData(cy, depths) {
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const depth = depths?.[node.id()];
      if (Number.isInteger(depth)) node.data("structuralDepth", depth);
    });
  });
}

function positionSignature(positions) {
  return Object.keys(positions).sort().map((id) => {
    const position = positions[id];
    return `${id}:${position.x.toFixed(3)},${position.y.toFixed(3)}`;
  }).join("|");
}

function positionsDiffer(left, right) {
  const leftIds = Object.keys(left ?? {}).sort();
  const rightIds = Object.keys(right ?? {}).sort();
  if (leftIds.length !== rightIds.length) return true;
  for (let index = 0; index < leftIds.length; index += 1) {
    if (leftIds[index] !== rightIds[index]) return true;
    const leftPoint = left[leftIds[index]];
    const rightPoint = right[rightIds[index]];
    if (!rightPoint || Math.hypot(leftPoint.x - rightPoint.x, leftPoint.y - rightPoint.y) > GEOMETRY_EPSILON) {
      return true;
    }
  }
  return false;
}

function applyLoopGeometry(edge, geometry) {
  edge.style("loop-direction", `${geometry.loopDirection}deg`);
  edge.style("loop-sweep", `${geometry.loopSweep}deg`);
}

function applyBezierGeometry(edge, geometry) {
  if (!geometry) return;
  edge.style("control-point-weights", geometry.weight);
  edge.style("control-point-distances", geometry.distance);
}

function bezierControlStyle(source, target, control) {
  const chord = subtract(target, source);
  const lengthSquared = dot(chord, chord);
  if (lengthSquared <= GEOMETRY_EPSILON) return null;

  const length = Math.sqrt(lengthSquared);
  const weight = dot(subtract(control, source), chord) / lengthSquared;
  const pointOnChord = add(source, scale(chord, weight));
  const normal = { x: -chord.y / length, y: chord.x / length };
  const distance = dot(subtract(control, pointOnChord), normal);
  return { weight, distance };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a, b) {
  if (!a || !b) return { x: 0, y: 0 };
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(vector, factor) {
  if (!vector) return null;
  return { x: vector.x * factor, y: vector.y * factor };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function normalize(vector) {
  if (!vector) return null;
  const length = Math.hypot(vector.x, vector.y);
  if (length <= GEOMETRY_EPSILON) return null;
  return { x: vector.x / length, y: vector.y / length };
}

function normalizeDegrees(angle) {
  return ((angle % 360) + 360) % 360;
}

function requireCytoscape() {
  if (typeof globalThis.cytoscape !== "function") {
    throw new Error("Cytoscape.js не загружен: интерактивный граф недоступен");
  }
  return globalThis.cytoscape;
}

function optimizationProfile(visibleCount) {
  return visibleCount > 160
    ? { samples: 3, maxPasses: 2, maxHotNodes: 6, maxEvaluations: 48 }
    : visibleCount > 80
      ? { samples: 4, maxPasses: 3, maxHotNodes: 8, maxEvaluations: 110 }
      : { samples: 6, maxPasses: 4, maxHotNodes: 10, maxEvaluations: 220 };
}

function layoutOptions(layoutId) {
  switch (layoutId) {
    case ROOTED_LAYOUT_ID:
      // Deterministic seed only. Structural radii are assigned after layoutstop.
      return {
        name: "concentric",
        avoidOverlap: true,
        minNodeSpacing: 40,
        padding: 46,
        concentric: (node) => node.data("root") === "yes" ? 1000 : 0,
        levelWidth: () => 1,
        animate: false,
        fit: true,
      };
    case "breadthfirst":
      return {
        name: "breadthfirst",
        directed: true,
        spacingFactor: 1.35,
        avoidOverlap: true,
        padding: 46,
      };
    case "circle":
      return { name: "circle", avoidOverlap: true, spacingFactor: 1.15, padding: 46 };
    case "grid":
      return { name: "grid", avoidOverlap: true, padding: 46 };
    case "concentric":
      return {
        name: "concentric",
        avoidOverlap: true,
        minNodeSpacing: 34,
        padding: 46,
        concentric: (node) => node.data("root") === "yes" ? 1000 : node.degree(),
        levelWidth: () => 2,
      };
    case "cose":
    default:
      return {
        name: "cose",
        idealEdgeLength: () => 92,
        nodeOverlap: 22,
        componentSpacing: 90,
        nestingFactor: 1.15,
        gravity: 0.35,
        numIter: 1200,
        initialTemp: 140,
        coolingFactor: 0.96,
        minTemp: 1,
        animate: false,
        randomize: true,
        fit: true,
        padding: 46,
      };
  }
}

export function graphStyle() {
  return cytoscapeGraphStyle();
}
