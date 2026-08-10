import assert from "node:assert/strict";
import test from "node:test";

import {
  asetToGraphElements,
  graphStyle,
  setGraphDebugState,
} from "../src/visualizer.js";

test("visualizer экспортирует API пошагового debugger", () => {
  assert.equal(typeof setGraphDebugState, "function");
});

test("рёбра графа несут linkId для debugger-подсветки", () => {
  const aset = {
    root: "R",
    links: [
      { id: "R", start: "R", end: "R" },
      { id: "O", start: "O", end: "R" },
    ],
  };

  const edges = asetToGraphElements(aset).filter((item) => item.data.role);
  assert.ok(edges.length > 0);
  assert.ok(edges.every((edge) => edge.data.linkId));
  assert.ok(edges.some((edge) => edge.data.linkId === "R"));
  assert.ok(edges.some((edge) => edge.data.linkId === "O"));
});

test("stylesheet содержит состояния hidden/created/reused/current", () => {
  const selectors = new Set(graphStyle().map((rule) => rule.selector));
  assert.ok(selectors.has("node.debug-hidden"));
  assert.ok(selectors.has("edge.debug-hidden"));
  assert.ok(selectors.has("node.debug-produced"));
  assert.ok(selectors.has("edge.debug-produced"));
  assert.ok(selectors.has("node.debug-reused"));
  assert.ok(selectors.has("edge.debug-reused"));
  assert.ok(selectors.has("node.debug-current"));
});
