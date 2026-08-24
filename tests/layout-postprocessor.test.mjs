import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analyzePathCrossings,
  minimizeArcCrossings,
  properSegmentsIntersect,
  sampleQuadraticBezier,
} from "../src/layout-postprocessor.js";
import {
  graphArcPaths,
  optimizeAsetLayoutPositions,
} from "../src/visualizer.js";

function straightPaths(edges, positions) {
  return edges.map(([id, source, target]) => ({
    id,
    source,
    target,
    points: [positions[source], positions[target]],
  }));
}

function crossedFixture() {
  const positions = {
    A: { x: 0, y: 0 },
    B: { x: 100, y: 100 },
    C: { x: 0, y: 100 },
    D: { x: 100, y: 0 },
  };
  const edges = [
    ["ab", "A", "B"],
    ["cd", "C", "D"],
  ];
  return { positions, edges };
}

test("strict crossing detector распознаёт X-пересечение", () => {
  assert.equal(
    properSegmentsIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ),
    true,
  );
});

test("касание общей вершины не считается пересечением", () => {
  const paths = [
    {
      id: "ab",
      source: "A",
      target: "B",
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    },
    {
      id: "ac",
      source: "A",
      target: "C",
      points: [{ x: 0, y: 0 }, { x: 10, y: -10 }],
    },
  ];

  assert.equal(analyzePathCrossings(paths).count, 0);
});

test("анализ пересечений считает пару дуг один раз и отмечает hot nodes", () => {
  const { positions, edges } = crossedFixture();
  const analysis = analyzePathCrossings(straightPaths(edges, positions));

  assert.equal(analysis.count, 1);
  assert.deepEqual(analysis.hotNodeCounts, { A: 1, B: 1, C: 1, D: 1 });
});

test("synthetic X-layout улучшается до меньшего crossing count", () => {
  const { positions, edges } = crossedFixture();
  const result = minimizeArcCrossings({
    positions,
    buildPaths: (candidate) => straightPaths(edges, candidate),
    maxPasses: 2,
    maxHotNodes: 4,
    maxEvaluations: 80,
    displacementWeight: 0,
  });

  assert.equal(result.crossingsBefore, 1);
  assert.equal(result.crossingsAfter, 0);
  assert.equal(result.changed, true);
});

test("постпроцессор детерминирован", () => {
  const { positions, edges } = crossedFixture();
  const options = {
    positions,
    buildPaths: (candidate) => straightPaths(edges, candidate),
    maxPasses: 3,
    maxHotNodes: 4,
    maxEvaluations: 90,
    displacementWeight: 0.1,
  };

  const first = minimizeArcCrossings(options);
  const second = minimizeArcCrossings(options);

  assert.deepEqual(first.positions, second.positions);
  assert.equal(first.crossingsAfter, second.crossingsAfter);
  assert.equal(first.evaluations, second.evaluations);
  assert.equal(first.passes, second.passes);
});

test("zero-crossing layout остаётся неизменным", () => {
  const positions = {
    A: { x: 0, y: 0 },
    B: { x: 100, y: 0 },
    C: { x: 0, y: 100 },
    D: { x: 100, y: 100 },
  };
  const edges = [
    ["ab", "A", "B"],
    ["cd", "C", "D"],
  ];
  const result = minimizeArcCrossings({
    positions,
    buildPaths: (candidate) => straightPaths(edges, candidate),
  });

  assert.equal(result.crossingsBefore, 0);
  assert.equal(result.crossingsAfter, 0);
  assert.equal(result.changed, false);
  assert.deepEqual(result.positions, positions);
});

test("постпроцессор никогда не возвращает больше пересечений, чем получил", () => {
  const positions = {
    A: { x: 0, y: 0 },
    B: { x: 120, y: 120 },
    C: { x: 0, y: 120 },
    D: { x: 120, y: 0 },
    E: { x: 60, y: -30 },
    F: { x: 60, y: 150 },
  };
  const edges = [
    ["ab", "A", "B"],
    ["cd", "C", "D"],
    ["ef", "E", "F"],
  ];
  const result = minimizeArcCrossings({
    positions,
    buildPaths: (candidate) => straightPaths(edges, candidate),
    maxEvaluations: 40,
  });

  assert.ok(result.crossingsAfter <= result.crossingsBefore);
  assert.ok(result.evaluations <= 40);
});

test("fixed node не сдвигается при оптимизации", () => {
  const { positions, edges } = crossedFixture();
  const result = minimizeArcCrossings({
    positions,
    buildPaths: (candidate) => straightPaths(edges, candidate),
    fixedIds: ["A"],
    maxPasses: 3,
    maxHotNodes: 4,
    maxEvaluations: 100,
    displacementWeight: 0,
  });

  assert.deepEqual(result.positions.A, positions.A);
  assert.ok(result.crossingsAfter <= result.crossingsBefore);
});

test("quadratic sampler сохраняет endpoints и заданную дискретизацию", () => {
  const points = sampleQuadraticBezier(
    { x: 0, y: 0 },
    { x: 50, y: 80 },
    { x: 100, y: 0 },
    5,
  );

  assert.equal(points.length, 6);
  assert.deepEqual(points[0], { x: 0, y: 0 });
  assert.deepEqual(points.at(-1), { x: 100, y: 0 });
});

test("graphArcPaths строит кривые и для self-loop, не меняя topology", () => {
  const aset = {
    root: "X",
    labels: {},
    links: [
      { id: "X", start: "X", end: "Y" },
      { id: "Y", start: "Y", end: "Y" },
    ],
  };
  const positions = {
    X: { x: 0, y: 0 },
    Y: { x: 100, y: 0 },
  };
  const paths = graphArcPaths(aset, positions, 300, 6);
  const xStart = paths.find((path) => path.id === "pole-start:X");
  const xEnd = paths.find((path) => path.id === "pole-end:X");

  assert.ok(xStart.points.length >= 6);
  assert.equal(xStart.source, "X");
  assert.equal(xStart.target, "X");
  assert.ok(xEnd.points.length >= 6);
  assert.equal(xEnd.source, "X");
  assert.equal(xEnd.target, "Y");
});

test("Aset wrapper фиксирует root и сохраняет crossing monotonicity", () => {
  const aset = {
    root: "A",
    labels: {},
    links: [
      { id: "A", start: "A", end: "B" },
      { id: "B", start: "C", end: "D" },
      { id: "C", start: "C", end: "C" },
      { id: "D", start: "D", end: "D" },
    ],
  };
  const positions = {
    A: { x: 0, y: 0 },
    B: { x: 100, y: 100 },
    C: { x: 0, y: 100 },
    D: { x: 100, y: 0 },
  };
  const result = optimizeAsetLayoutPositions(aset, positions, {
    samples: 3,
    maxPasses: 2,
    maxHotNodes: 4,
    maxEvaluations: 30,
  });

  assert.deepEqual(result.positions.A, positions.A);
  assert.ok(result.crossingsAfter <= result.crossingsBefore);
});

test("integration: полный postprocess запускается после layoutstop, но не на manual position", async () => {
  const source = await readFile(new URL("../src/visualizer.js", import.meta.url), "utf8");

  assert.match(source, /cy\.on\("layoutstop", postprocessLayout\)/);
  assert.match(
    source,
    /rooted\s*\?\s*optimizeRootedNetworkLayoutPositions\(network, positions, \{ visibleKeys, rootKey \}\)\s*:\s*optimizeNetworkLayoutPositions\(network, positions, \{ visibleKeys, rootKey \}\)/,
  );

  const positionHandler = source.match(/cy\.on\("position", "node", \(\) => \{([\s\S]*?)\}\);/);
  assert.ok(positionHandler, "position handler должен существовать");
  assert.match(positionHandler[1], /alignArcs\(\)/);
  assert.doesNotMatch(
    positionHandler[1],
    /optimize(?:Rooted)?(?:Aset|Network)LayoutPositions|postprocessLayout/,
  );
});
