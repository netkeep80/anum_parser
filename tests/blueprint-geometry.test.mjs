import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BLUEPRINT_UPSTREAM,
  blueprintCubicSegmentDerivativeAtEnd,
  blueprintCubicSegmentDerivativeAtStart,
  blueprintGeometryIsFinite,
  blueprintSegmentsAreC1,
  buildBlueprintGeometry,
  createBlueprintInitialPositions,
} from "../src/blueprint-geometry.js";
import { buildVisualModel } from "../src/visual-model.js";

function fixture() {
  return {
    root: "R",
    labels: { R: "∞", A: "a", B: "b", X: "x" },
    links: [
      { id: "R", start: "R", end: "R" },
      { id: "A", start: "A", end: "R" },
      { id: "B", start: "R", end: "B" },
      { id: "X", start: "A", end: "B" },
    ],
  };
}

function linkById(geometry, id) {
  const link = geometry.links.find((candidate) => candidate.linkId === id);
  assert.ok(link, `blueprint link ${id} must exist`);
  return link;
}

function assertPointNear(actual, expected, epsilon = 1e-9) {
  assert.ok(actual && expected);
  const scaleX = Math.max(1, Math.abs(actual.x), Math.abs(expected.x));
  const scaleY = Math.max(1, Math.abs(actual.y), Math.abs(expected.y));
  assert.ok(Math.abs(actual.x - expected.x) <= epsilon * scaleX, `x: ${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= epsilon * scaleY, `y: ${actual.y} != ${expected.y}`);
}

test("blueprint geometry pins exact audited upstream provenance", () => {
  assert.deepEqual(BLUEPRINT_UPSTREAM, {
    repository: "konard/links-visuals",
    commit: "f377441533e4f10fa94aaa07138b684df88234b1",
    license: "Unlicense",
    references: [
      "animated-blueprint.html",
      "js/path.mjs",
      "js/ik-pure.mjs",
      "js/blueprint-link.mjs",
      "grid.html",
      "docs/case-studies/issue-28/README.md",
    ],
  });
});

test("initial blueprint layout is deterministic and roots the Aset root at origin", () => {
  const model = buildVisualModel(fixture());
  const first = createBlueprintInitialPositions(model);
  const second = createBlueprintInitialPositions(model);

  assert.deepEqual(first, second);
  assert.deepEqual(first.R, { x: 0, y: 0 });
  assert.equal(Object.keys(first).length, model.nodes.length);
});

test("blueprint geometry is deterministic and finite", () => {
  const model = buildVisualModel(fixture());
  const positions = createBlueprintInitialPositions(model);
  const first = buildBlueprintGeometry(model, positions);
  const second = buildBlueprintGeometry(model, positions);

  assert.deepEqual(first, second);
  assert.equal(blueprintGeometryIsFinite(first), true);
});

test("semantic start/end are pinned to referenced link centers", () => {
  const model = buildVisualModel(fixture());
  const positions = {
    R: { x: 0, y: 0 },
    A: { x: -180, y: 25 },
    B: { x: 210, y: -35 },
    X: { x: 15, y: 140 },
  };
  const geometry = buildBlueprintGeometry(model, positions);
  const link = linkById(geometry, "X");

  assert.deepEqual(link.center, positions.X);
  assert.deepEqual(link.startAnchor, positions.A);
  assert.deepEqual(link.endAnchor, positions.B);
  assert.equal(link.startId, "A");
  assert.equal(link.endId, "B");
});

test("one canonical blueprint path crosses the semantic link center without a path break", () => {
  const model = buildVisualModel(fixture());
  const geometry = buildBlueprintGeometry(model);
  const link = linkById(geometry, "X");

  assert.deepEqual(link.points[4], link.center);
  assert.deepEqual(link.pathPoints[4], link.center);
  assert.deepEqual(link.segments[3].to, link.center);
  assert.deepEqual(link.segments[4].from, link.center);
  assert.match(link.path, /^M /);
  assert.equal((link.path.match(/\bM\b/g) ?? []).length, 1);
  assert.equal((link.path.match(/\bC\b/g) ?? []).length, 8);
  assert.equal("startPath" in link, false);
  assert.equal("endPath" in link, false);
});

test("Catmull-Rom cubic chain is C1 through every control point including semantic center", () => {
  const model = buildVisualModel(fixture());
  const geometry = buildBlueprintGeometry(model, {
    R: { x: 0, y: 0 },
    A: { x: -173, y: 39 },
    B: { x: 241, y: -57 },
    X: { x: 21, y: 147 },
  });

  for (const link of geometry.links) {
    assert.equal(link.segments.length, 8);
    assert.equal(blueprintSegmentsAreC1(link.segments), true, `${link.linkId} must be C1`);
    for (let index = 0; index < link.segments.length - 1; index += 1) {
      const left = link.segments[index];
      const right = link.segments[index + 1];
      assertPointNear(left.to, right.from);
      assertPointNear(
        blueprintCubicSegmentDerivativeAtEnd(left),
        blueprintCubicSegmentDerivativeAtStart(right),
      );
    }

    const beforeCenter = link.segments[3];
    const afterCenter = link.segments[4];
    assert.deepEqual(beforeCenter.to, link.center);
    assert.deepEqual(afterCenter.from, link.center);
    assertPointNear(
      blueprintCubicSegmentDerivativeAtEnd(beforeCenter),
      blueprintCubicSegmentDerivativeAtStart(afterCenter),
    );
  }
});

test("C1 checker rejects a broken tangent even when segment endpoints still meet", () => {
  const model = buildVisualModel(fixture());
  const link = linkById(buildBlueprintGeometry(model), "X");
  const broken = structuredClone(link.segments);
  broken[4].control1.x += 0.25;

  assert.deepEqual(broken[3].to, broken[4].from);
  assert.equal(blueprintSegmentsAreC1(broken), false);
});

test("semantic self-link keeps exact anchors while producing one visible finite C1 curve", () => {
  const model = buildVisualModel(fixture());
  const geometry = buildBlueprintGeometry(model);
  const root = linkById(geometry, "R");

  assert.equal(root.selfStart, true);
  assert.equal(root.selfEnd, true);
  assert.deepEqual(root.startAnchor, root.center);
  assert.deepEqual(root.endAnchor, root.center);
  assert.equal(blueprintGeometryIsFinite(geometry), true);
  assert.equal(blueprintSegmentsAreC1(root.segments), true);
  assert.ok(
    root.pathPoints.some((point) => Math.hypot(point.x - root.center.x, point.y - root.center.y) > 1),
    "self-link must remain visibly curved instead of collapsing to one point",
  );
  assert.match(root.path, /^M /);
  assert.equal((root.path.match(/\bM\b/g) ?? []).length, 1);
  assert.equal((root.path.match(/\bC\b/g) ?? []).length, 8);
});

test("custom center movement automatically repins dependent link geometry", () => {
  const model = buildVisualModel(fixture());
  const beforePositions = createBlueprintInitialPositions(model);
  const afterPositions = structuredClone(beforePositions);
  afterPositions.A = { x: beforePositions.A.x - 73, y: beforePositions.A.y + 41 };

  const before = linkById(buildBlueprintGeometry(model, beforePositions), "X");
  const after = linkById(buildBlueprintGeometry(model, afterPositions), "X");

  assert.deepEqual(after.startAnchor, afterPositions.A);
  assert.notDeepEqual(after.startAnchor, before.startAnchor);
  assert.deepEqual(after.center, before.center);
  assert.deepEqual(after.endAnchor, before.endAnchor);
  assert.equal(blueprintSegmentsAreC1(after.segments), true);
});

test("empty visual model has a valid empty blueprint projection", () => {
  const geometry = buildBlueprintGeometry({ rootId: null, nodes: [], arcs: [] });
  assert.deepEqual(geometry.positions, {});
  assert.deepEqual(geometry.links, []);
  assert.equal(blueprintGeometryIsFinite(geometry), true);
});

test("pure blueprint geometry has no renderer or MTS runtime dependency", async () => {
  const source = await readFile(new URL("../src/blueprint-geometry.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /cytoscape/i);
  assert.doesNotMatch(source, /three(?:\.js)?/i);
  assert.doesNotMatch(source, /@mts\/core/i);
  assert.doesNotMatch(source, /\bimport\s+.*\bd3\b/i);
  assert.doesNotMatch(source, /esm\.sh/i);
});
