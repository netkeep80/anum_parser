const graphStates = new WeakMap();
const ARC_TANGENT_LENGTH = 26;
const GEOMETRY_EPSILON = 1e-9;

export const GRAPH_LAYOUTS = Object.freeze([
  { id: "cose", title: "CoSE" },
  { id: "breadthfirst", title: "Дерево" },
  { id: "circle", title: "Круг" },
  { id: "grid", title: "Сетка" },
  { id: "concentric", title: "Концентрическая" },
]);

export function asetToGraphElements(aset, limit = 300) {
  if (!aset?.links?.length) return [];
  const links = aset.links.slice(0, limit);
  const visible = new Set(links.map((link) => link.id));
  const elements = [];

  for (const link of links) {
    const semanticLabel = aset.labels?.[link.id];
    const label = semanticLabel && semanticLabel !== link.id
      ? `${link.id}\n${semanticLabel}`
      : link.id;
    elements.push({
      data: {
        id: link.id,
        label,
        linkId: link.id,
        start: link.start,
        end: link.end,
        root: link.id === aset.root ? "yes" : "no",
      },
    });
  }

  for (const link of links) {
    if (visible.has(link.start)) {
      elements.push({
        data: {
          id: `pole-start:${link.id}`,
          source: link.id,
          target: link.start,
          linkId: link.id,
          role: "start",
          label: "начало",
        },
      });
    }
    if (visible.has(link.end)) {
      elements.push({
        data: {
          id: `pole-end:${link.id}`,
          source: link.id,
          target: link.end,
          linkId: link.id,
          role: "end",
          label: "конец",
        },
      });
    }
  }
  return elements;
}

// В базовой проекции обе роли хранятся как link -> pole. Для визуального языка МТС
// start должен входить в центральный узел связи: startPole -> link,
// а end — выходить из него: link -> endPole.
export function graphElementsForRendering(aset, limit = 300) {
  return asetToGraphElements(aset, limit).map((element) => {
    if (element.data?.role !== "start") return element;
    return {
      ...element,
      data: {
        ...element.data,
        source: element.data.target,
        target: element.data.source,
      },
    };
  });
}

// Строит две контрольные точки рядом с центром связи так, чтобы лучи,
// уходящие от центра к start- и end-дуге, были строго антипараллельны.
// Это геометрический инвариант представления и не меняет семантическую
// ориентацию startPole -> link -> endPole.
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

export function renderAset(container, aset, options = {}) {
  destroyGraph(container);
  if (!aset?.links?.length) {
    container.replaceChildren();
    return;
  }

  const cytoscape = requireCytoscape();
  const layoutId = options.layout ?? container.dataset.layout ?? "cose";
  container.dataset.layout = layoutId;
  const elements = graphElementsForRendering(aset);
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

  const alignArcs = () => alignPoleArcs(cy);
  cy.on("layoutstop", alignArcs);
  cy.on("position", "node", alignArcs);
  cy.ready(alignArcs);

  const resizeObserver = new ResizeObserver(() => cy.resize());
  resizeObserver.observe(container);
  graphStates.set(container, { cy, resizeObserver, aset });
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

  const { cy, aset } = state;
  const visible = debugState
    ? new Set(debugState.visibleLinkIds ?? [])
    : new Set(aset.links.map((link) => link.id));
  const produced = new Set(debugState?.producedLinks ?? []);
  const reused = new Set(debugState?.reusedLinks ?? []);
  const current = debugState?.current ?? null;

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
      startEdge.style("loop-direction", "-90deg");
      endEdge.style("loop-direction", "90deg");
      return;
    }

    if (startSelf) {
      const endAngle = angleDegrees(subtract(endPosition, centerPosition));
      startEdge.style("loop-direction", `${normalizeDegrees(endAngle + 180)}deg`);
      return;
    }

    const startAngle = angleDegrees(subtract(startPosition, centerPosition));
    endEdge.style("loop-direction", `${normalizeDegrees(startAngle + 180)}deg`);
  });
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

function angleDegrees(vector) {
  return Math.atan2(vector.y, vector.x) * 180 / Math.PI;
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

function layoutOptions(layoutId) {
  switch (layoutId) {
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
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        "font-family": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        "font-size": "10px",
        color: "#f4f7ff",
        "text-outline-color": "#111a2f",
        "text-outline-width": 2,
        "background-color": "#18233d",
        "border-color": "#6d83ad",
        "border-width": 1.5,
        width: 44,
        height: 44,
      },
    },
    {
      selector: 'node[root = "yes"]',
      style: {
        "background-color": "#174238",
        "border-color": "#67e8b3",
        "border-width": 3,
        width: 54,
        height: 54,
        "font-size": "11px",
        "font-weight": "bold",
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-color": "#ffd47a",
        "border-width": 4,
      },
    },
    {
      selector: "edge",
      style: {
        width: 2,
        "curve-style": "unbundled-bezier",
        "source-arrow-shape": "none",
        "target-arrow-shape": "none",
        "arrow-scale": 0.92,
        label: "data(label)",
        "font-family": "Inter, system-ui, sans-serif",
        "font-size": "8px",
        color: "#8ea2c8",
        "text-background-color": "#08101d",
        "text-background-opacity": 0.82,
        "text-background-padding": "2px",
        "text-rotation": "autorotate",
        "line-cap": "round",
      },
    },
    {
      selector: 'edge[role = "start"]',
      style: {
        label: "",
        "curve-style": "unbundled-bezier",
        "control-point-distances": -34,
        "control-point-weights": 0.5,
        "loop-direction": "-90deg",
        "loop-sweep": "-65deg",
        "line-fill": "linear-gradient",
        "line-gradient-stop-colors": "#ff657a #67e8b3",
        "line-gradient-stop-positions": "0% 100%",
        "line-color": "#67e8b3",
        "source-arrow-shape": "none",
        "target-arrow-shape": "none",
        "source-label": "×",
        "source-text-offset": 8,
        "source-text-rotation": "none",
        "font-size": "16px",
        "font-weight": "bold",
        color: "#ff657a",
        "text-background-opacity": 0,
      },
    },
    {
      selector: 'edge[role = "end"]',
      style: {
        label: "",
        "curve-style": "unbundled-bezier",
        "control-point-distances": 34,
        "control-point-weights": 0.5,
        "loop-direction": "90deg",
        "loop-sweep": "65deg",
        "line-fill": "linear-gradient",
        "line-gradient-stop-colors": "#67e8b3 #73a7ff",
        "line-gradient-stop-positions": "0% 100%",
        "line-color": "#67e8b3",
        "source-arrow-shape": "none",
        "target-arrow-shape": "triangle",
        "target-arrow-color": "#73a7ff",
        "target-arrow-fill": "filled",
      },
    },
    {
      selector: "node.debug-hidden",
      style: { display: "none" },
    },
    {
      selector: "edge.debug-hidden",
      style: { display: "none" },
    },
    {
      selector: "node.debug-produced",
      style: {
        "background-color": "#174238",
        "border-color": "#67e8b3",
        "border-width": 4,
      },
    },
    {
      selector: "edge.debug-produced",
      style: {
        "line-fill": "solid",
        "line-color": "#67e8b3",
        "target-arrow-color": "#67e8b3",
        width: 4,
      },
    },
    {
      selector: "node.debug-reused",
      style: {
        "border-color": "#6bdcff",
        "border-style": "dashed",
        "border-width": 4,
      },
    },
    {
      selector: "edge.debug-reused",
      style: {
        "line-fill": "solid",
        "line-color": "#6bdcff",
        "target-arrow-color": "#6bdcff",
        "line-style": "dashed",
        width: 4,
      },
    },
    {
      selector: "node.debug-current",
      style: {
        "border-color": "#ffd47a",
        "border-style": "solid",
        "border-width": 5,
      },
    },
    {
      selector: "edge:selected",
      style: {
        width: 3.5,
        color: "#eef3ff",
      },
    },
  ];
}
