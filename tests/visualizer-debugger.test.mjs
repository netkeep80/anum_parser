import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  asetToGraphElements,
  graphStyle,
  setGraphDebugState,
} from "../src/visualizer.js";

function styleFor(selector) {
  const rule = graphStyle().find((item) => item.selector === selector);
  assert.ok(rule, `style rule ${selector} must exist`);
  return rule.style;
}

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

test("debugger edge states не перетирают RGB-семантику полюсов", () => {
  const produced = styleFor("edge.debug-produced");
  const reused = styleFor("edge.debug-reused");

  for (const style of [produced, reused]) {
    assert.equal(style["line-fill"], undefined);
    assert.equal(style["line-color"], undefined);
    assert.equal(style["target-arrow-color"], undefined);
  }

  assert.equal(produced.width, 4);
  assert.equal(reused.width, 4);
  assert.equal(reused["line-style"], "dashed");

  assert.equal(styleFor('edge[role = "start"]')["line-gradient-stop-colors"], "#ff657a #67e8b3");
  assert.equal(styleFor('edge[role = "end"]')["line-gradient-stop-colors"], "#67e8b3 #73a7ff");
  assert.equal(styleFor('edge[role = "end"]')["target-arrow-color"], "#73a7ff");
});

test("debugger расположен слева от графа в полноширинном адаптивном workspace", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  const workspace = html.match(/<section class="machine-workspace"[\s\S]*?<\/section>\s*<section class="panel trace-panel">/u)?.[0] ?? "";
  assert.ok(workspace.includes('class="panel debugger-panel"'));
  assert.ok(workspace.includes('class="panel graph-panel"'));
  assert.ok(workspace.indexOf('class="panel debugger-panel"') < workspace.indexOf('class="panel graph-panel"'));

  assert.match(css, /\.hero, main, footer \{ width: calc\(100% - 32px\); max-width: none;/u);
  assert.match(css, /\.machine-workspace \{[\s\S]*?grid-template-columns: minmax\(420px, \.88fr\) minmax\(560px, 1\.35fr\);/u);
  assert.match(css, /@media \(max-width: 1150px\) \{[\s\S]*?\.machine-workspace \{ grid-template-columns: 1fr; \}/u);
});
