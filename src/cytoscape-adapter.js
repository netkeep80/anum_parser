import { SEMANTIC_COLORS } from "./visual-model.js";

export const START_LOOP_SWEEP_DEG = -65;
export const END_LOOP_SWEEP_DEG = 65;

export function visualModelToCytoscapeElements(visualModel, options = {}) {
  const legacyPoleOrientation = options.legacyPoleOrientation === true;
  const elements = [];

  for (const node of visualModel?.nodes ?? []) {
    elements.push({
      data: {
        id: node.id,
        label: node.label,
        linkId: node.linkId,
        start: node.startId,
        end: node.endId,
        root: node.root ? "yes" : "no",
      },
    });
  }

  for (const arc of visualModel?.arcs ?? []) {
    const source = legacyPoleOrientation
      ? arc.linkId
      : arc.semanticSource;
    const target = legacyPoleOrientation
      ? arc.poleId
      : arc.semanticTarget;
    elements.push({
      data: {
        id: arc.id,
        source,
        target,
        linkId: arc.linkId,
        role: arc.role,
        label: arc.role === "start" ? "начало" : "конец",
      },
    });
  }

  return elements;
}

export function cytoscapeGraphStyle() {
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
        "background-color": "#174238",
        "border-color": SEMANTIC_COLORS.center,
        "border-width": 1.5,
        width: 44,
        height: 44,
      },
    },
    {
      selector: 'node[root = "yes"]',
      style: {
        "background-color": "#174238",
        "border-color": SEMANTIC_COLORS.center,
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
        "loop-sweep": `${START_LOOP_SWEEP_DEG}deg`,
        "line-fill": "linear-gradient",
        "line-gradient-stop-colors": `${SEMANTIC_COLORS.start} ${SEMANTIC_COLORS.center}`,
        "line-gradient-stop-positions": "0% 100%",
        "line-color": SEMANTIC_COLORS.center,
        "source-arrow-shape": "none",
        "target-arrow-shape": "none",
        "source-label": "×",
        "source-text-offset": 8,
        "source-text-rotation": "none",
        "font-size": "16px",
        "font-weight": "bold",
        color: SEMANTIC_COLORS.start,
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
        "loop-sweep": `${END_LOOP_SWEEP_DEG}deg`,
        "line-fill": "linear-gradient",
        "line-gradient-stop-colors": `${SEMANTIC_COLORS.center} ${SEMANTIC_COLORS.end}`,
        "line-gradient-stop-positions": "0% 100%",
        "line-color": SEMANTIC_COLORS.center,
        "source-arrow-shape": "none",
        "target-arrow-shape": "triangle",
        "target-arrow-color": SEMANTIC_COLORS.end,
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
        "border-color": SEMANTIC_COLORS.center,
        "border-width": 4,
      },
    },
    {
      selector: "edge.debug-produced",
      style: {
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
