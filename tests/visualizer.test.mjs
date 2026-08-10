import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { graphElementsForRendering, graphStyle } from "../src/visualizer.js";

function styleFor(selector) {
  const rule = graphStyle().find((item) => item.selector === selector);
  assert.ok(rule, `style rule ${selector} must exist`);
  return rule.style;
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

test("начало связи — дуга с красным крестиком и градиентом красный -> зелёный к связи", () => {
  const style = styleFor('edge[role = "start"]');

  assert.equal(style["curve-style"], "unbundled-bezier");
  assert.ok(style["control-point-distances"] < 0);
  assert.equal(style["source-label"], "×");
  assert.equal(style["target-label"], undefined);
  assert.equal(style["source-arrow-shape"], "none");
  assert.equal(style["target-arrow-shape"], "none");
  assert.equal(style["line-fill"], "linear-gradient");
  assert.equal(style["line-gradient-stop-colors"], "#ff657a #67e8b3");
  assert.equal(style["line-gradient-stop-positions"], "0% 100%");
});

test("конец связи — дуга от связи с градиентом зелёный -> красный и красным треугольником", () => {
  const start = styleFor('edge[role = "start"]');
  const end = styleFor('edge[role = "end"]');

  assert.equal(end["curve-style"], "unbundled-bezier");
  assert.ok(end["control-point-distances"] > 0);
  assert.equal(end["control-point-distances"], -start["control-point-distances"]);
  assert.equal(end["source-arrow-shape"], "none");
  assert.equal(end["target-arrow-shape"], "triangle");
  assert.equal(end["target-arrow-color"], "#ff657a");
  assert.equal(end["line-fill"], "linear-gradient");
  assert.equal(end["line-gradient-stop-colors"], "#67e8b3 #ff657a");
  assert.equal(end["line-gradient-stop-positions"], "0% 100%");
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
