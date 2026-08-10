import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { graphStyle } from "../src/visualizer.js";

function styleFor(selector) {
  const rule = graphStyle().find((item) => item.selector === selector);
  assert.ok(rule, `style rule ${selector} must exist`);
  return rule.style;
}

test("начало связи — дуга с крестиком у начального полюса и градиентом красный -> зелёный к связи", () => {
  const style = styleFor('edge[role = "start"]');

  assert.equal(style["curve-style"], "unbundled-bezier");
  assert.ok(style["control-point-distances"] < 0);
  assert.equal(style["target-label"], "×");
  assert.equal(style["source-label"], undefined);
  assert.equal(style["source-arrow-shape"], "none");
  assert.equal(style["target-arrow-shape"], "none");
  assert.equal(style["line-fill"], "linear-gradient");
  // Ребро Cytoscape хранится link -> start, поэтому визуальный смысл start -> link
  // требует обратного порядка stop-цветов: зелёный у связи, красный у начального полюса.
  assert.equal(style["line-gradient-stop-colors"], "#67e8b3 #ff657a");
  assert.equal(style["line-gradient-stop-positions"], "0% 100%");
});

test("конец связи — встречная дуга со стрелкой и градиентом зелёный -> синий", () => {
  const start = styleFor('edge[role = "start"]');
  const end = styleFor('edge[role = "end"]');

  assert.equal(end["curve-style"], "unbundled-bezier");
  assert.ok(end["control-point-distances"] > 0);
  assert.equal(end["control-point-distances"], -start["control-point-distances"]);
  assert.equal(end["source-arrow-shape"], "none");
  assert.equal(end["target-arrow-shape"], "triangle");
  assert.equal(end["target-arrow-color"], "#73a7ff");
  assert.equal(end["line-fill"], "linear-gradient");
  assert.equal(end["line-gradient-stop-colors"], "#67e8b3 #73a7ff");
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
