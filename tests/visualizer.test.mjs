import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cytoscapeLoopAngleForScreenVector,
  doubleSelfLoopGeometry,
  graphElementsForRendering,
  graphStyle,
  pairedArcControlGeometry,
  semanticLoopRayAngle,
  singleSelfLoopGeometry,
} from "../src/visualizer.js";

function styleFor(selector) {
  const rule = graphStyle().find((item) => item.selector === selector);
  assert.ok(rule, `style rule ${selector} must exist`);
  return rule.style;
}

function vector(from, to) {
  return { x: to.x - from.x, y: to.y - from.y };
}

function cosine(a, b) {
  return (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
}

function assertOpposite(a, b) {
  assert.ok(Math.abs(cosine(a, b) + 1) < 1e-12, `vectors must be opposite: ${JSON.stringify({ a, b })}`);
}

function assertSameAngle(actual, expected) {
  const delta = Math.abs(((actual - expected + 540) % 360) - 180);
  assert.ok(delta < 1e-12, `angles differ: actual=${actual}, expected=${expected}`);
}

test("визуальная ориентация связи X = A ⟼ B: начало A -> X, конец X -> B", () => {
  const aset = {
    root: "X",
    labels: {},
    links: [
      { id: "X", start: "A", end: "B" },
      { id: "A", start: "A", end: "A" },
      { id: "B", start: "B", end: "B" },
    ],
  };
  const elements = graphElementsForRendering(aset);
  const start = elements.find((item) => item.data.id === "pole-start:X");
  const end = elements.find((item) => item.data.id === "pole-end:X");

  assert.deepEqual([start.data.source, start.data.target], ["A", "X"]);
  assert.deepEqual([end.data.source, end.data.target], ["X", "B"]);
});

test("начало связи — красный -> зелёный к центру связи", () => {
  const style = styleFor('edge[role = "start"]');

  assert.equal(style["curve-style"], "unbundled-bezier");
  assert.equal(style["source-label"], "×");
  assert.equal(style["target-label"], undefined);
  assert.equal(style["source-arrow-shape"], "none");
  assert.equal(style["target-arrow-shape"], "none");
  assert.equal(style["line-fill"], "linear-gradient");
  assert.equal(style["line-gradient-stop-colors"], "#ff657a #67e8b3");
  assert.equal(style["line-gradient-stop-positions"], "0% 100%");
  assert.equal(style["loop-sweep"], "-65deg");
});

test("конец связи — зелёный -> синий от центра связи и синяя стрелка", () => {
  const end = styleFor('edge[role = "end"]');

  assert.equal(end["curve-style"], "unbundled-bezier");
  assert.equal(end["source-arrow-shape"], "none");
  assert.equal(end["target-arrow-shape"], "triangle");
  assert.equal(end["target-arrow-color"], "#73a7ff");
  assert.equal(end["line-fill"], "linear-gradient");
  assert.equal(end["line-gradient-stop-colors"], "#67e8b3 #73a7ff");
  assert.equal(end["line-gradient-stop-positions"], "0% 100%");
  assert.equal(end["loop-sweep"], "65deg");
});

test("все node — зелёные центры RGB-схемы, root отличается не цветом, а размером и рамкой", () => {
  const node = styleFor("node");
  const root = styleFor('node[root = "yes"]');

  assert.equal(node["background-color"], "#174238");
  assert.equal(node["border-color"], "#67e8b3");
  assert.equal(root["background-color"], "#174238");
  assert.equal(root["border-color"], "#67e8b3");
  assert.ok(root.width > node.width);
  assert.ok(root.height > node.height);
  assert.ok(root["border-width"] > node["border-width"]);
});

test("start/end дуги уходят от центра связи под 180 градусов", () => {
  const center = { x: 20, y: -10 };
  const startPole = { x: -80, y: 35 };
  const endPole = { x: 95, y: 70 };
  const geometry = pairedArcControlGeometry(center, startPole, endPole, 30);
  const startTangent = vector(center, geometry.startControl);
  const endTangent = vector(center, geometry.endControl);

  assertOpposite(startTangent, endTangent);
  assert.ok(geometry.startStyle);
  assert.ok(geometry.endStyle);
  assert.ok(Number.isFinite(geometry.startStyle.weight));
  assert.ok(Number.isFinite(geometry.startStyle.distance));
  assert.ok(Number.isFinite(geometry.endStyle.weight));
  assert.ok(Number.isFinite(geometry.endStyle.distance));
});

test("вырожденная одинаковая сторона всё равно получает антиподальные касательные", () => {
  const center = { x: 0, y: 0 };
  const startPole = { x: 100, y: 0 };
  const endPole = { x: 200, y: 0 };
  const geometry = pairedArcControlGeometry(center, startPole, endPole, 24);
  const startTangent = vector(center, geometry.startControl);
  const endTangent = vector(center, geometry.endControl);

  assertOpposite(startTangent, endTangent);
});

test("углы Cytoscape считаются от 12 часов по часовой стрелке", () => {
  assertSameAngle(cytoscapeLoopAngleForScreenVector({ x: 0, y: -1 }), 0);
  assertSameAngle(cytoscapeLoopAngleForScreenVector({ x: 1, y: 0 }), 90);
  assertSameAngle(cytoscapeLoopAngleForScreenVector({ x: 0, y: 1 }), 180);
  assertSameAngle(cytoscapeLoopAngleForScreenVector({ x: -1, y: 0 }), 270);
});

test("start self-loop получает GREEN-касательную строго напротив обычного end", () => {
  const center = { x: 10, y: 15 };
  const endPole = { x: 110, y: 65 };
  const geometry = singleSelfLoopGeometry(center, endPole, "start", 30);

  assertOpposite(geometry.selfOutward, geometry.companionOutward);
  assert.ok(geometry.companionStyle);
  assert.equal(geometry.loop.semanticEndpoint, "target");
  assert.equal(geometry.loop.loopSweep, -65);
  assertSameAngle(
    semanticLoopRayAngle(
      geometry.loop.loopDirection,
      geometry.loop.semanticEndpoint,
      geometry.loop.loopSweep,
    ),
    cytoscapeLoopAngleForScreenVector(geometry.selfOutward),
  );
});

test("end self-loop получает GREEN-касательную строго напротив обычного start", () => {
  const center = { x: -20, y: 30 };
  const startPole = { x: -120, y: 80 };
  const geometry = singleSelfLoopGeometry(center, startPole, "end", 30);

  assertOpposite(geometry.selfOutward, geometry.companionOutward);
  assert.ok(geometry.companionStyle);
  assert.equal(geometry.loop.semanticEndpoint, "source");
  assert.equal(geometry.loop.loopSweep, 65);
  assertSameAngle(
    semanticLoopRayAngle(
      geometry.loop.loopDirection,
      geometry.loop.semanticEndpoint,
      geometry.loop.loopSweep,
    ),
    cytoscapeLoopAngleForScreenVector(geometry.selfOutward),
  );
});

test("double self-loop имеет две антиподальные GREEN-касательные", () => {
  const geometry = doubleSelfLoopGeometry();

  assertOpposite(geometry.startOutward, geometry.endOutward);
  assert.equal(geometry.startLoop.semanticEndpoint, "target");
  assert.equal(geometry.endLoop.semanticEndpoint, "source");
  assertSameAngle(geometry.startLoop.loopDirection, geometry.endLoop.loopDirection + 180);
  assertSameAngle(
    semanticLoopRayAngle(
      geometry.startLoop.loopDirection,
      geometry.startLoop.semanticEndpoint,
      geometry.startLoop.loopSweep,
    ),
    cytoscapeLoopAngleForScreenVector(geometry.startOutward),
  );
  assertSameAngle(
    semanticLoopRayAngle(
      geometry.endLoop.loopDirection,
      geometry.endLoop.semanticEndpoint,
      geometry.endLoop.loopSweep,
    ),
    cytoscapeLoopAngleForScreenVector(geometry.endOutward),
  );
});

test("панель управления участвует в общем скролле страницы", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const controlsRule = css.match(/\.controls\s*\{([^}]*)\}/s);

  assert.ok(controlsRule, "правило .controls должно существовать");
  assert.doesNotMatch(controlsRule[1], /position\s*:\s*sticky/i);
  assert.doesNotMatch(controlsRule[1], /\btop\s*:/i);
  assert.doesNotMatch(css, /position\s*:\s*sticky/i);
});

test("легенда повторяет RGB-язык дуг: красный -> зелёный -> синий", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(css, /--end:\s*#73a7ff/);
  assert.match(css, /\.start-line::after\s*\{\s*background:\s*linear-gradient\(90deg, var\(--start\), var\(--b\)\);\s*\}/s);
  assert.match(css, /\.end-line::before\s*\{\s*background:\s*linear-gradient\(90deg, var\(--b\), var\(--end\)\);\s*\}/s);
  assert.match(css, /border-left:\s*8px solid var\(--end\)/);
});

test("версия приложения имеет semver и выводится браузерным UI из package.json", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.match(indexHtml, /id="appVersion"/);
  assert.match(appSource, /fetch\("\.\/package\.json"/);
  assert.match(appSource, /document\.title = `anum_parser v\$\{version\}/);
});
