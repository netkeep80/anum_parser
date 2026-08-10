const graphStates = new WeakMap();

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
          role: "end",
          label: "конец",
        },
      });
    }
  }
  return elements;
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
  const elements = asetToGraphElements(aset);
  const cy = cytoscape({
    container,
    elements,
    style: graphStyle(),
    layout: layoutOptions(layoutId),
    minZoom: 0.08,
    maxZoom: 8,
    wheelSensitivity: 0.22,
    userZoomingEnabled: true,
    userPanningEnabled: true,
    autoungrabify: false,
    boxSelectionEnabled: false,
  });

  const resizeObserver = new ResizeObserver(() => cy.resize());
  resizeObserver.observe(container);
  graphStates.set(container, { cy, resizeObserver, aset });
  if (options.debug) setGraphDebugState(container, options.debug);
}

export function setGraphDebugState(container, debug = null) {
  const state = graphStates.get(container);
  if (!state) return;
  const { cy } = state;
  const visible = debug?.visibleLinkIds ? new Set(debug.visibleLinkIds) : null;
  const produced = new Set(debug?.producedLinks ?? []);
  const reused = new Set(debug?.reusedLinks ?? []);

  cy.batch(() => {
    cy.elements().removeClass("debug-current debug-added debug-reused");
    cy.nodes().forEach((node) => {
      const shown = visible === null || visible.has(node.id());
      node.style("display", shown ? "element" : "none");
      if (!shown) return;
      if (node.id() === debug?.current) node.addClass("debug-current");
      if (produced.has(node.id())) node.addClass("debug-added");
      if (reused.has(node.id())) node.addClass("debug-reused");
    });
    cy.edges().forEach((edge) => {
      const shown = edge.source().style("display") !== "none" && edge.target().style("display") !== "none";
      edge.style("display", shown ? "element" : "none");
    });
    for (const id of produced) cy.getElementById(id).connectedEdges().addClass("debug-added");
    for (const id of reused) cy.getElementById(id).connectedEdges().addClass("debug-reused");
  });
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

export function destroyGraph(container) {
  const state = graphStates.get(container);
  if (!state) return;
  state.resizeObserver.disconnect();
  state.cy.destroy();
  graphStates.delete(container);
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

function graphStyle() {
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
      selector: "node.debug-current",
      style: {
        "border-color": "#ffd47a",
        "border-width": 5,
      },
    },
    {
      selector: "node.debug-added",
      style: {
        "background-color": "#185c48",
        "border-color": "#67e8b3",
        "border-width": 5,
      },
    },
    {
      selector: "node.debug-reused",
      style: {
        "border-color": "#67d5ff",
        "border-width": 5,
        "border-style": "dashed",
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-width": 5,
        "border-color": "#ffb86b",
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.6,
        "curve-style": "bezier",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.8,
        label: "data(label)",
        "font-family": "Inter, system-ui, sans-serif",
        "font-size": "8px",
        color: "#8ea2c8",
        "text-background-color": "#08101d",
        "text-background-opacity": 0.82,
        "text-background-padding": "2px",
        "text-rotation": "autorotate",
      },
    },
    {
      selector: 'edge[role = "start"]',
      style: {
        "line-color": "#73a7ff",
        "target-arrow-color": "#73a7ff",
        "line-style": "dashed",
      },
    },
    {
      selector: 'edge[role = "end"]',
      style: {
        "line-color": "#67e8b3",
        "target-arrow-color": "#67e8b3",
        "line-style": "solid",
      },
    },
    {
      selector: "edge.debug-added",
      style: {
        width: 4,
        opacity: 1,
      },
    },
    {
      selector: "edge.debug-reused",
      style: {
        width: 3,
        "line-style": "dotted",
        opacity: 1,
      },
    },
    {
      selector: "edge:selected",
      style: { width: 4 },
    },
  ];
}
