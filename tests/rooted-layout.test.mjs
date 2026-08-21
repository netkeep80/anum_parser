import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRootedStructuralLayout,
  computeStructuralDepths,
  createRadialProjector,
  radialDistance,
} from "../src/rooted-layout.js";
import { minimizeRootedArcCrossings } from "../src/rooted-crossing.js";

function link(id, start, end) {
  return { id, start, end };
}

function radius(center, point) {
  return radialDistance(center, point);
}

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("акорень self-loop имеет structural depth 0, а цепочка растёт наружу", () => {
  const aset = {
    root: "R",
    links: [
      link("R", "R", "R"),
      link("A", "R", "R"),
      link("B", "A", "R"),
      link("C", "B", "A"),
      link("D", "R", "C"),
    ],
  };

  const { depths } = computeStructuralDepths(aset);
  assert.deepEqual(depths, { A: 1, B: 2, C: 3, D: 4, R: 0 });
  assert.equal(depths.D, 4, "прямая зависимость D от R не должна превращать depth в shortest-path=1");
});

test("self-loop вне root конечен и наследует глубину внешних зависимостей", () => {
  const aset = {
    root: "R",
    links: [
      link("R", "R", "R"),
      link("X", "X", "R"),
      link("Y", "X", "R"),
    ],
  };

  const { depths } = computeStructuralDepths(aset);
  assert.equal(depths.R, 0);
  assert.equal(depths.X, 1);
  assert.equal(depths.Y, 2);
});

test("взаимно рекурсивная SCC получает один structural depth", () => {
  const aset = {
    root: "R",
    links: [
      link("R", "R", "R"),
      link("A", "B", "R"),
      link("B", "A", "R"),
      link("C", "A", "R"),
    ],
  };

  const analysis = computeStructuralDepths(aset);
  assert.equal(analysis.depths.A, 1);
  assert.equal(analysis.depths.B, 1);
  assert.equal(analysis.depths.C, 2);
  assert.equal(analysis.componentIds.A, analysis.componentIds.B);
  assert.notEqual(analysis.componentIds.A, analysis.componentIds.C);
});

test("radial layout кодирует depth точным расстоянием от акорня", () => {
  const aset = {
    root: "R",
    links: [
      link("R", "R", "R"),
      link("A", "R", "R"),
      link("A2", "R", "R"),
      link("B", "A", "R"),
      link("C", "B", "A2"),
    ],
  };
  const seed = {
    R: { x: 20, y: 10 },
    A: { x: 110, y: 10 },
    A2: { x: -70, y: 20 },
    B: { x: 20, y: 120 },
    C: { x: 15, y: -100 },
  };

  const first = buildRootedStructuralLayout(aset, seed, { layerSpacing: 90, minimumNodeSpacing: 44 });
  const second = buildRootedStructuralLayout(aset, seed, { layerSpacing: 90, minimumNodeSpacing: 44 });

  assert.deepEqual(first.positions, second.positions, "одинаковый topology + seed должен давать тот же layout");
  assert.deepEqual(first.positions.R, first.center);
  close(radius(first.center, first.positions.R), 0);
  close(radius(first.center, first.positions.A), first.layerSpacing);
  close(radius(first.center, first.positions.A2), first.layerSpacing);
  close(radius(first.center, first.positions.B), first.layerSpacing * 2);
  close(radius(first.center, first.positions.C), first.layerSpacing * 3);
  assert.ok(radius(first.center, first.positions.C) > radius(first.center, first.positions.B));
  assert.ok(radius(first.center, first.positions.B) > radius(first.center, first.positions.A));
});

test("единый layerSpacing увеличивается при плотном кольце, но r = depth * spacing сохраняется", () => {
  const links = [link("R", "R", "R")];
  const seed = { R: { x: 0, y: 0 } };
  for (let index = 0; index < 24; index += 1) {
    const id = `L${String(index).padStart(2, "0")}`;
    links.push(link(id, "R", "R"));
    seed[id] = { x: Math.cos(index) * 50, y: Math.sin(index) * 50 };
  }

  const layout = buildRootedStructuralLayout(
    { root: "R", links },
    seed,
    { layerSpacing: 40, minimumNodeSpacing: 50 },
  );

  assert.ok(layout.layerSpacing > 40);
  for (const id of Object.keys(seed).filter((id) => id !== "R")) {
    close(radius(layout.center, layout.positions[id]), layout.layerSpacing);
  }
});

test("radial projector сохраняет назначенный радиус при произвольном angular move", () => {
  const center = { x: 10, y: -20 };
  const projector = createRadialProjector(center, { A: 120, R: 0 }, { A: 0 });

  const projected = projector("A", { x: 1000, y: 350 });
  close(radius(center, projected), 120);
  assert.deepEqual(projector("R", { x: 999, y: 999 }), center);
});

test("angular crossing minimizer уменьшает X-пересечение, не меняя structural radius", () => {
  const center = { x: 0, y: 0 };
  const positions = {
    R: { x: 0, y: 0 },
    A: { x: 100, y: 0 },
    B: { x: 0, y: 100 },
    C: { x: -100, y: 0 },
    D: { x: 0, y: -100 },
  };
  const radii = { R: 0, A: 100, B: 100, C: 100, D: 100 };
  const projectPosition = createRadialProjector(center, radii);
  const buildPaths = (candidate) => [
    { id: "ac", source: "A", target: "C", points: [candidate.A, candidate.C] },
    { id: "bd", source: "B", target: "D", points: [candidate.B, candidate.D] },
  ];

  const first = minimizeRootedArcCrossings({
    positions,
    center,
    projectPosition,
    buildPaths,
    fixedIds: ["R"],
    minimumSpacing: 20,
    maxEvaluations: 120,
  });
  const second = minimizeRootedArcCrossings({
    positions,
    center,
    projectPosition,
    buildPaths,
    fixedIds: ["R"],
    minimumSpacing: 20,
    maxEvaluations: 120,
  });

  assert.equal(first.crossingsBefore, 1);
  assert.equal(first.crossingsAfter, 0);
  assert.ok(first.crossingsAfter <= first.crossingsBefore);
  assert.deepEqual(first, second, "angular optimizer должен быть детерминированным");
  assert.deepEqual(first.positions.R, center);
  for (const id of ["A", "B", "C", "D"]) close(radius(center, first.positions[id]), 100);
});
