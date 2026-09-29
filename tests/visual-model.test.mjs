import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SEMANTIC_COLORS,
  cytoscapeGraphStyle,
  visualNetworkToCytoscapeElements,
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

test("VisualLinkNetwork projection is deterministic and preserves semantic orientation", () => {
  const a = projectAsetToVisualLinkNetwork(fixture());
  const b = projectAsetToVisualLinkNetwork(fixture());
  assert.deepEqual(a, b);

  const byKey = new Map(a.links.map((link) => [link.key, link]));
  assert.deepEqual(
    [byKey.get("X")?.startKey, byKey.get("X")?.endKey],
    ["A", "B"],
  );
  assert.equal(byKey.get("X")?.label, "центр");
});

test("Cytoscape projection consumes VisualLinkNetwork directly", () => {
  const network = projectAsetToVisualLinkNetwork(fixture());
  const elements = visualNetworkToCytoscapeElements(network, {
    visibleKeys: ["X", "A", "B"],
    rootKey: "X",
  });
  const start = elements.find((element) => element.data.id === "pole-start:X");
  const end = elements.find((element) => element.data.id === "pole-end:X");
  const center = elements.find((element) => element.data.id === "X");

  assert.deepEqual([start.data.source, start.data.target], ["A", "X"]);
  assert.deepEqual([end.data.source, end.data.target], ["X", "B"]);
  assert.equal(center.data.label, "X\nцентр");
  assert.equal(center.data.root, "yes");
});

test("visibility boundary is expressed by shared-network keys, not a second topology DTO", () => {
  const network = projectAsetToVisualLinkNetwork(fixture());
  const elements = visualNetworkToCytoscapeElements(network, {
    visibleKeys: ["X", "A"],
    rootKey: "X",
  });
  const nodes = elements.filter((element) => !element.data.role);
  const start = elements.find((element) => element.data.id === "pole-start:X");
  const end = elements.find((element) => element.data.id === "pole-end:X");

  assert.deepEqual(nodes.map((element) => element.data.id), ["X", "A"]);
  assert.deepEqual([start.data.source, start.data.target], ["A", "X"]);
  assert.equal(end, undefined);
});

test("public structural facades are equivalent to the VisualLinkNetwork adapter", () => {
  const aset = fixture();
  const network = projectAsetToVisualLinkNetwork(aset);
  const visibleKeys = aset.links.map((link) => link.id);

  assert.deepEqual(
    graphElementsForRendering(aset),
    visualNetworkToCytoscapeElements(network, {
      visibleKeys,
      rootKey: aset.root,
    }),
  );
  assert.deepEqual(
    asetToGraphElements(aset),
    visualNetworkToCytoscapeElements(network, {
      visibleKeys,
      rootKey: aset.root,
      legacyPoleOrientation: true,
    }),
  );
});

test("structural and blueprint production do not rebuild parser-local visual topology", async () => {
  const [appSource, visualizerSource, rootedSource, cytoscapeSource] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/visualizer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/rooted-layout.js", import.meta.url), "utf8"),
    readFile(new URL("../src/cytoscape-adapter.js", import.meta.url), "utf8"),
  ]);

  assert.equal(existsSync(new URL("../src/visual-model.js", import.meta.url)), false);
  assert.doesNotMatch(appSource, /\bbuildVisualModel\b|state\.visualModel|ensureBlueprintVisualModel/);
  assert.doesNotMatch(visualizerSource, /\bbuildVisualModel\b/);
  assert.doesNotMatch(cytoscapeSource, /visualModelToCytoscapeElements|\.\/visual-model\.js/);
  assert.doesNotMatch(
    rootedSource,
    /aset\?\.links|link\?\.start\b|link\?\.end\b/,
    "rooted structural depth must consume VisualLinkNetwork topology",
  );
  assert.match(
    appSource,
    /createBlueprintRenderer\(ui\.graph,\s*state\.visualNetwork,/,
    "blueprint must consume the same shared VisualLinkNetwork",
  );
});

test("Cytoscape keeps RGB presentation semantics without owning topology", () => {
  assert.equal(styleFor("node")["border-color"], SEMANTIC_COLORS.center);
  assert.equal(
    styleFor('edge[role = "start"]')["line-gradient-stop-colors"],
    `${SEMANTIC_COLORS.start} ${SEMANTIC_COLORS.center}`,
  );
  assert.equal(
    styleFor('edge[role = "end"]')["line-gradient-stop-colors"],
    `${SEMANTIC_COLORS.center} ${SEMANTIC_COLORS.end}`,
  );
  assert.equal(
    styleFor('edge[role = "end"]')["target-arrow-color"],
    SEMANTIC_COLORS.end,
  );
});

test("debugger Cytoscape styles cannot overwrite semantic RGB", () => {
  for (const style of [styleFor("edge.debug-produced"), styleFor("edge.debug-reused")]) {
    assert.equal(style["line-fill"], undefined);
    assert.equal(style["line-color"], undefined);
    assert.equal(style["line-gradient-stop-colors"], undefined);
    assert.equal(style["target-arrow-color"], undefined);
  }
});
