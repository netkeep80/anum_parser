import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addVec3,
  centerlinePoint3d,
  centerlineUnitTangent3d,
  crossVec3,
  deterministicLoopPlaneNormal3d,
  deterministicSpringFrames3d,
  dotVec3,
  doubleSelfLoopGeometry3d,
  isFiniteVec3,
  normVec3,
  normalizeVec3,
  pairedArcControlGeometry3d,
  sampleCenterline3d,
  scaleVec3,
  semanticLinkGeometry3d,
  singleSelfLoopGeometry3d,
  springCurveAroundCenterline3d,
  springEnvelope3d,
  springEnvelopeDerivative3d,
  stableOrthogonalVec3,
  subtractVec3,
} from "../src/geometry3d.js";
import { SEMANTIC_COLORS, buildVisualModel } from "../src/visual-model.js";

const EPS = 1e-9;
const CENTER = Object.freeze({ x: 0, y: 0, z: 0 });

function approx(actual, expected, epsilon = EPS) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} ≈ ${expected} (±${epsilon})`,
  );
}

function approxVec(actual, expected, epsilon = EPS) {
  approx(actual.x, expected.x, epsilon);
  approx(actual.y, expected.y, epsilon);
  approx(actual.z, expected.z, epsilon);
}

function assertUnit(vector, epsilon = EPS) {
  approx(normVec3(vector), 1, epsilon);
}

function assertFinitePoints(points) {
  assert.ok(points.length > 0);
  for (const point of points) assert.ok(isFiniteVec3(point), JSON.stringify(point));
}

function greenOutwardFromCenterline(centerline) {
  if (centerline.greenEndpoint === "source") {
    return centerlineUnitTangent3d(centerline, 0);
  }
  return scaleVec3(centerlineUnitTangent3d(centerline, 1), -1);
}

function assertGreenAntiparallel(geometry, epsilon = EPS) {
  const start = normalizeVec3(greenOutwardFromCenterline(geometry.start));
  const end = normalizeVec3(greenOutwardFromCenterline(geometry.end));
  assert.ok(start);
  assert.ok(end);
  approx(dotVec3(start, end), -1, epsilon);
  approxVec(start, geometry.start.greenOutwardTangent, epsilon);
  approxVec(end, geometry.end.greenOutwardTangent, epsilon);
}

test("Vec3 algebra and stable orthogonal are deterministic", () => {
  const a = { x: 2, y: -1, z: 4 };
  const b = { x: -3, y: 5, z: 2 };

  assert.deepEqual(addVec3(a, b), { x: -1, y: 4, z: 6 });
  assert.deepEqual(subtractVec3(a, b), { x: 5, y: -6, z: 2 });
  assert.deepEqual(scaleVec3(a, 2), { x: 4, y: -2, z: 8 });
  assert.equal(dotVec3(a, b), -3);
  assert.deepEqual(crossVec3(a, b), { x: -22, y: -16, z: 7 });
  approx(normVec3({ x: 3, y: 4, z: 12 }), 13);

  const orthogonal = stableOrthogonalVec3(a);
  assert.deepEqual(orthogonal, stableOrthogonalVec3(a));
  assertUnit(orthogonal);
  approx(dotVec3(normalizeVec3(a), orthogonal), 0);
});

test("ordinary non-coplanar link preserves semantic orientation and true 3D 180°", () => {
  const startPole = { x: 2, y: 1, z: 3 };
  const endPole = { x: -1, y: 4, z: 2 };
  const geometry = pairedArcControlGeometry3d(CENTER, startPole, endPole);

  assert.deepEqual(centerlinePoint3d(geometry.start, 0), startPole);
  assert.deepEqual(centerlinePoint3d(geometry.start, 1), CENTER);
  assert.deepEqual(centerlinePoint3d(geometry.end, 0), CENTER);
  assert.deepEqual(centerlinePoint3d(geometry.end, 1), endPole);
  assert.equal(geometry.start.role, "start");
  assert.equal(geometry.start.semanticOrientation, "outer-to-green");
  assert.equal(geometry.start.greenEndpoint, "target");
  assert.equal(geometry.end.role, "end");
  assert.equal(geometry.end.semanticOrientation, "green-to-outer");
  assert.equal(geometry.end.greenEndpoint, "source");
  assertGreenAntiparallel(geometry);
});

test("collinear and coincident degenerate geometry stays finite and deterministic", () => {
  const cases = [
    [{ x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
    [{ x: 2, y: 0, z: 0 }, { x: -4, y: 0, z: 0 }],
    [CENTER, CENTER],
    [{ x: 1e-15, y: 0, z: 0 }, { x: 0, y: -1e-15, z: 0 }],
  ];

  for (const [startPole, endPole] of cases) {
    const geometry = pairedArcControlGeometry3d(CENTER, startPole, endPole);
    assert.deepEqual(
      geometry,
      pairedArcControlGeometry3d(CENTER, startPole, endPole),
    );
    assertFinitePoints(sampleCenterline3d(geometry.start, 32));
    assertFinitePoints(sampleCenterline3d(geometry.end, 32));
    assertGreenAntiparallel(geometry);
  }
});

test("single start self-loop has deterministic plane and opposite GREEN tangent", () => {
  const companion = { x: 2, y: 3, z: 4 };
  const geometry = singleSelfLoopGeometry3d(CENTER, companion, "start");

  assert.deepEqual(geometry, singleSelfLoopGeometry3d(CENTER, companion, "start"));
  assert.equal(geometry.start.loop, true);
  assert.equal(geometry.start.role, "start");
  assert.equal(geometry.end.role, "end");
  assert.deepEqual(centerlinePoint3d(geometry.start, 0), CENTER);
  assert.deepEqual(centerlinePoint3d(geometry.start, 1), CENTER);
  assert.deepEqual(centerlinePoint3d(geometry.end, 0), CENTER);
  assert.deepEqual(centerlinePoint3d(geometry.end, 1), companion);
  approx(dotVec3(geometry.planeNormal, geometry.selfOutward), 0);
  assertGreenAntiparallel(geometry);
  assertFinitePoints(sampleCenterline3d(geometry.start, 48));
});

test("single end self-loop has deterministic plane and opposite GREEN tangent", () => {
  const companion = { x: -2, y: 5, z: 1 };
  const geometry = singleSelfLoopGeometry3d(CENTER, companion, "end");

  assert.deepEqual(geometry, singleSelfLoopGeometry3d(CENTER, companion, "end"));
  assert.equal(geometry.start.role, "start");
  assert.equal(geometry.end.loop, true);
  assert.equal(geometry.end.role, "end");
  assert.deepEqual(centerlinePoint3d(geometry.start, 0), companion);
  assert.deepEqual(centerlinePoint3d(geometry.start, 1), CENTER);
  assert.deepEqual(centerlinePoint3d(geometry.end, 0), CENTER);
  assert.deepEqual(centerlinePoint3d(geometry.end, 1), CENTER);
  approx(dotVec3(geometry.planeNormal, geometry.selfOutward), 0);
  assertGreenAntiparallel(geometry);
  assertFinitePoints(sampleCenterline3d(geometry.end, 48));
});

test("double self-loop is deterministic, distinct and 180° at GREEN", () => {
  const geometry = doubleSelfLoopGeometry3d(CENTER);

  assert.deepEqual(geometry, doubleSelfLoopGeometry3d(CENTER));
  assert.equal(geometry.start.loop, true);
  assert.equal(geometry.end.loop, true);
  assert.notDeepEqual(geometry.start.controlPoints, geometry.end.controlPoints);
  assertGreenAntiparallel(geometry);
  assertFinitePoints(sampleCenterline3d(geometry.start, 48));
  assertFinitePoints(sampleCenterline3d(geometry.end, 48));
});

test("loop plane normal is a deterministic function of direction and role", () => {
  const direction = { x: 3, y: -4, z: 5 };
  const start = deterministicLoopPlaneNormal3d(direction, "start");
  const end = deterministicLoopPlaneNormal3d(direction, "end");

  assert.deepEqual(start, deterministicLoopPlaneNormal3d(direction, "start"));
  assert.deepEqual(end, deterministicLoopPlaneNormal3d(direction, "end"));
  assertUnit(start);
  assertUnit(end);
  approx(dotVec3(normalizeVec3(direction), start), 0);
  approxVec(end, scaleVec3(start, -1));
});

test("semanticLinkGeometry3d dispatches ordinary and self cases without renderer state", () => {
  const startPole = { x: 2, y: 1, z: 3 };
  const endPole = { x: -1, y: 4, z: 2 };

  assert.deepEqual(
    semanticLinkGeometry3d({ center: CENTER, startPole, endPole }),
    pairedArcControlGeometry3d(CENTER, startPole, endPole),
  );
  assert.equal(
    semanticLinkGeometry3d({ center: CENTER, startPole: CENTER, endPole, startSelf: true }).start.loop,
    true,
  );
  assert.equal(
    semanticLinkGeometry3d({ center: CENTER, startPole, endPole: CENTER, endSelf: true }).end.loop,
    true,
  );
  const double = semanticLinkGeometry3d({
    center: CENTER,
    startPole: CENTER,
    endPole: CENTER,
    startSelf: true,
    endSelf: true,
  });
  assert.equal(double.start.loop, true);
  assert.equal(double.end.loop, true);
});

test("3D centerline roles consume the same renderer-neutral RGB semantics", () => {
  const visual = buildVisualModel({
    root: "X",
    labels: {},
    links: [
      { id: "X", start: "A", end: "B" },
      { id: "A", start: "A", end: "A" },
      { id: "B", start: "B", end: "B" },
    ],
  });
  const startArc = visual.arcs.find((arc) => arc.id === "pole-start:X");
  const endArc = visual.arcs.find((arc) => arc.id === "pole-end:X");
  const geometry = pairedArcControlGeometry3d(
    CENTER,
    { x: 2, y: 1, z: 3 },
    { x: -1, y: 4, z: 2 },
  );

  assert.equal(geometry.start.role, startArc.role);
  assert.equal(geometry.end.role, endArc.role);
  assert.deepEqual(
    [startArc.colorFrom, startArc.colorTo],
    [SEMANTIC_COLORS.start, SEMANTIC_COLORS.center],
  );
  assert.deepEqual(
    [endArc.colorFrom, endArc.colorTo],
    [SEMANTIC_COLORS.center, SEMANTIC_COLORS.end],
  );
});

test("spring envelope exactly preserves endpoints and first derivatives", () => {
  const radius = 0.23;
  assert.equal(springEnvelope3d(0, radius), 0);
  assert.equal(springEnvelope3d(1, radius), 0);
  assert.equal(springEnvelopeDerivative3d(0, radius), 0);
  assert.ok(Object.is(springEnvelopeDerivative3d(1, radius), -0)
    || springEnvelopeDerivative3d(1, radius) === 0);
  approx(springEnvelope3d(0.5, radius), radius);
});

test("spring frame is deterministic and orthonormal without random twist", () => {
  const centerline = pairedArcControlGeometry3d(
    CENTER,
    { x: 2, y: 1, z: 3 },
    { x: -1, y: 4, z: 2 },
  ).start;
  const frames = deterministicSpringFrames3d(centerline, 64);

  assert.deepEqual(frames, deterministicSpringFrames3d(centerline, 64));
  for (const frame of frames) {
    assertUnit(frame.tangent, 1e-8);
    assertUnit(frame.normal, 1e-8);
    assertUnit(frame.binormal, 1e-8);
    approx(dotVec3(frame.tangent, frame.normal), 0, 1e-8);
    approx(dotVec3(frame.tangent, frame.binormal), 0, 1e-8);
    approx(dotVec3(frame.normal, frame.binormal), 0, 1e-8);
  }
});

test("visible spring keeps exact centerline endpoints and endpoint tangents", () => {
  const centerline = pairedArcControlGeometry3d(
    CENTER,
    { x: 2, y: 1, z: 3 },
    { x: -1, y: 4, z: 2 },
  ).start;
  const spring = springCurveAroundCenterline3d(centerline, {
    coilRadius: 0.12,
    turnCount: 5,
    segments: 2000,
  });

  assert.deepEqual(spring.points[0], centerlinePoint3d(centerline, 0));
  assert.deepEqual(spring.points.at(-1), centerlinePoint3d(centerline, 1));
  approxVec(spring.startTangent, centerlineUnitTangent3d(centerline, 0));
  approxVec(spring.endTangent, centerlineUnitTangent3d(centerline, 1));

  const sampledStartTangent = normalizeVec3(subtractVec3(spring.points[1], spring.points[0]));
  const sampledEndTangent = normalizeVec3(subtractVec3(spring.points.at(-1), spring.points.at(-2)));
  assert.ok(dotVec3(sampledStartTangent, spring.startTangent) > 0.999);
  assert.ok(dotVec3(sampledEndTangent, spring.endTangent) > 0.999);
  assertFinitePoints(spring.points);
});

test("spring wrapping preserves GREEN-center 180° for ordinary and self links", () => {
  const geometries = [
    pairedArcControlGeometry3d(
      CENTER,
      { x: 2, y: 1, z: 3 },
      { x: -1, y: 4, z: 2 },
    ),
    singleSelfLoopGeometry3d(CENTER, { x: 2, y: 3, z: 4 }, "start"),
    singleSelfLoopGeometry3d(CENTER, { x: -2, y: 5, z: 1 }, "end"),
    doubleSelfLoopGeometry3d(CENTER),
  ];

  for (const geometry of geometries) {
    const startSpring = springCurveAroundCenterline3d(geometry.start, {
      coilRadius: 0.1,
      turnCount: 4,
    });
    const endSpring = springCurveAroundCenterline3d(geometry.end, {
      coilRadius: 0.1,
      turnCount: 4,
    });
    approx(
      dotVec3(
        normalizeVec3(startSpring.greenOutwardTangent),
        normalizeVec3(endSpring.greenOutwardTangent),
      ),
      -1,
      1e-9,
    );
    assertFinitePoints(startSpring.points);
    assertFinitePoints(endSpring.points);
  }
});

test("pure 3D geometry has no Three.js, Cytoscape, MTS or random dependency", async () => {
  const source = await readFile(new URL("../src/geometry3d.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /from\s+["']three(?:\/|["'])/i);
  assert.doesNotMatch(source, /\bTHREE\./);
  assert.doesNotMatch(source, /cytoscape/i);
  assert.doesNotMatch(source, /@mts\/core/i);
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /Date\.now|performance\.now/);
});
