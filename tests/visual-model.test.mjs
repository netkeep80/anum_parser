import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SEMANTIC_COLORS,
  buildVisualModel,
  normalizeVisualDebugState,
  visualDebugFlags,
} from "../src/visual-model.js";
import {
  cytoscapeGraphStyle,
  visualModelToCytoscapeElements,
} from "../src/cytoscape-adapter.js";
import { projectAsetToVisualLinkNetwork } from "../src/mts-visual-adapter.js";
import {
  asetToGraphElements,
  graphElementsForRendering,
} from "../src/visualizer.js";

function fixture() {
  return {
    root: "X",
    labels: { X: "центр" },
    links: [
      { id: "X", start: "A", end: "B" },
      { id: "A", start: "A", end: "A" },
      { id: "B", start: "B", end: "B" },
    ],
  };
}

function styleFor(selector) {
  const rule = cytoscapeGraphStyle().find((item) => item.selector === selector);
  assert.ok(rule, `style rule ${selector} must exist`);
  return rule.style;
}

test("visual model детерминирован и не зависит от renderer", () => {
  const aset = fixture();
  assert.deepEqual(buildVisualModel(aset), buildVisualModel(aset));
});

test("visual model хранит semantic orientation и RGB ровно один раз", () => {
  const model = buildVisualModel(fixture());
  const center = model.nodes.find((node) => node.id === "X");
  const start = model.arcs.find((arc) => arc.id === "pole-start:X");
  const end = model.arcs.find((arc) => arc.id === "pole-end:X");

  assert.equal(model.rootId, "X");
  assert.equal(center.root, true);
  assert.equal(center.semanticColor, SEMANTIC_COLORS.center);
  assert.equal(center.label, "X\nцентр");

  assert.deepEqual(
    [start.semanticSource, start.semanticTarget],
    ["A", "X"],
  );
  assert.deepEqual(
    [start.colorFrom, start.colorTo, start.arrow],
    [SEMANTIC_COLORS.start, SEMANTIC_COLORS.center, "none"],
  );

  assert.deepEqual(
    [end.semanticSource, end.semanticTarget],
    ["X", "B"],
  );
  assert.deepEqual(
    [end.colorFrom, end.colorTo, end.arrow],
    [SEMANTIC_COLORS.center, SEMANTIC_COLORS.end, "target"],
  );
});

test("limit сохраняет прежний visibility boundary для дуг", () => {
  const model = buildVisualModel(fixture(), 2);

  assert.deepEqual(model.nodes.map((node) => node.id), ["X", "A"]);
  assert.ok(model.arcs.some((arc) => arc.id === "pole-start:X"));
  assert.ok(!model.arcs.some((arc) => arc.id === "pole-end:X"));
});

test("Cytoscape semantic projection сохраняет A -> X -> B", () => {
  const elements = visualModelToCytoscapeElements(buildVisualModel(fixture()));
  const start = elements.find((element) => element.data.id === "pole-start:X");
  const end = elements.find((element) => element.data.id === "pole-end:X");

  assert.deepEqual([start.data.source, start.data.target], ["A", "X"]);
  assert.deepEqual([end.data.source, end.data.target], ["X", "B"]);
});

test("VisualLinkNetwork projection сохраняет A -> X и Aset-order visibility boundary", async () => {
  const network = projectAsetToVisualLinkNetwork(fixture());
  const adapter = await import("../src/cytoscape-adapter.js");

  assert.equal(
    typeof adapter.visualNetworkToCytoscapeElements,
    "function",
    "structural 2D must expose a VisualLinkNetwork-native Cytoscape projection",
  );

  const elements = adapter.visualNetworkToCytoscapeElements(network, {
    visibleKeys: ["X", "A"],
    rootKey: "X",
  });
  const nodes = elements.filter((element) => !element.data.role);
  const start = elements.find((element) => element.data.id === "pole-start:X");
  const end = elements.find((element) => element.data.id === "pole-end:X");

  assert.deepEqual(nodes.map((element) => element.data.id), ["X", "A"]);
  assert.equal(nodes[0].data.label, "X\nцентр");
  assert.equal(nodes[0].data.root, "yes");
  assert.deepEqual([start.data.source, start.data.target], ["A", "X"]);
  assert.equal(end, undefined, "END arc to non-visible B must stay omitted");
});

test("structural 2D production не читает вторую Aset/visualModel topology", async () => {
  const [visualizerSource, rootedSource] = await Promise.all([
    readFile(new URL("../src/visualizer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/rooted-layout.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(
    visualizerSource,
    /buildVisualModel/,
    "structural renderer must not rebuild parser-local visual topology",
  );
  assert.doesNotMatch(
    rootedSource,
    /aset\?\.links|link\?\.start|link\?\.end/,
    "rooted structural depth must consume VisualLinkNetwork topology",
  );
});

test("legacy Cytoscape facade сохраняет прежнюю link -> pole проекцию", () => {
  const elements = visualModelToCytoscapeElements(
    buildVisualModel(fixture()),
    { legacyPoleOrientation: true },
  );
  const start = elements.find((element) => element.data.id === "pole-start:X");
  const end = elements.find((element) => element.data.id === "pole-end:X");

  assert.deepEqual([start.data.source, start.data.target], ["X", "A"]);
  assert.deepEqual([end.data.source, end.data.target], ["X", "B"]);
});

test("public visualizer facade использует shared visual model без semantic fork", () => {
  const aset = fixture();
  const model = buildVisualModel(aset);

  assert.deepEqual(
    graphElementsForRendering(aset),
    visualModelToCytoscapeElements(model),
  );
  assert.deepEqual(
    asetToGraphElements(aset),
    visualModelToCytoscapeElements(model, { legacyPoleOrientation: true }),
  );
});

test("renderer-neutral debugger state не мутирует semantic model", () => {
  const model = buildVisualModel(fixture());
  const before = structuredClone(model);
  const debug = normalizeVisualDebugState(model, {
    visibleLinkIds: ["B", "X", "unknown"],
    producedLinks: ["A", "unknown"],
    reusedLinks: ["B"],
    current: "X",
  });

  assert.deepEqual(debug, {
    visibleLinkIds: ["X", "B"],
    producedLinks: ["A"],
    reusedLinks: ["B"],
    current: "X",
  });
  assert.deepEqual(model, before);
  assert.deepEqual(visualDebugFlags(debug, "X"), {
    visible: true,
    produced: false,
    reused: false,
    current: true,
  });
});

test("debugger Cytoscape styles не имеют права переопределять semantic RGB дуг", () => {
  const produced = styleFor("edge.debug-produced");
  const reused = styleFor("edge.debug-reused");

  for (const style of [produced, reused]) {
    assert.equal(style["line-fill"], undefined);
    assert.equal(style["line-color"], undefined);
    assert.equal(style["line-gradient-stop-colors"], undefined);
    assert.equal(style["target-arrow-color"], undefined);
  }

  assert.equal(
    styleFor('edge[role = "start"]')["line-gradient-stop-colors"],
    `${SEMANTIC_COLORS.start} ${SEMANTIC_COLORS.center}`,
  );
  assert.equal(
    styleFor('edge[role = "end"]')["line-gradient-stop-colors"],
    `${SEMANTIC_COLORS.center} ${SEMANTIC_COLORS.end}`,
  );
});

test("pure visual model не импортирует Cytoscape, Three.js или @mts/core", async () => {
  const source = await readFile(new URL("../src/visual-model.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /cytoscape/i);
  assert.doesNotMatch(source, /three(?:\.js)?/i);
  assert.doesNotMatch(source, /@mts\/core/i);
});
