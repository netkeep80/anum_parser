const GEOMETRY_EPSILON = 1e-12;
const DEFAULT_TANGENT_LENGTH = 0.35;
const DEFAULT_LOOP_RADIUS = 0.8;
const TAU = Math.PI * 2;

const AXES = Object.freeze([
  Object.freeze({ x: 1, y: 0, z: 0 }),
  Object.freeze({ x: 0, y: 1, z: 0 }),
  Object.freeze({ x: 0, y: 0, z: 1 }),
]);

function cloneVec3(v) {
  return { x: Number(v?.x ?? 0), y: Number(v?.y ?? 0), z: Number(v?.z ?? 0) };
}

function clamp01(t) {
  return Math.max(0, Math.min(1, Number(t)));
}

function optionNumber(value, fallback, predicate = Number.isFinite) {
  const number = Number(value);
  return predicate(number) ? number : fallback;
}

export function addVec3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtractVec3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVec3(v, factor) {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

export function dotVec3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossVec3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function normVec3(v) {
  return Math.hypot(v.x, v.y, v.z);
}

export function normalizeVec3(v) {
  const length = normVec3(v);
  if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) return null;
  return scaleVec3(v, 1 / length);
}

export function isFiniteVec3(v) {
  return Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.z);
}

// Стабильная ортогональ без PRNG: выбираем глобальную ось,
// наименее параллельную входному направлению.
export function stableOrthogonalVec3(direction) {
  const unit = normalizeVec3(direction) ?? AXES[0];
  let basis = AXES[0];
  let alignment = Math.abs(dotVec3(unit, basis));
  for (const candidate of AXES.slice(1)) {
    const candidateAlignment = Math.abs(dotVec3(unit, candidate));
    if (candidateAlignment < alignment) {
      basis = candidate;
      alignment = candidateAlignment;
    }
  }
  return normalizeVec3(crossVec3(unit, basis))
    ?? normalizeVec3(crossVec3(unit, AXES[2]))
    ?? AXES[1];
}

export function quadraticPoint3d(p0, p1, p2, t) {
  const u = clamp01(t);
  if (u === 0) return cloneVec3(p0);
  if (u === 1) return cloneVec3(p2);
  const inverse = 1 - u;
  return addVec3(
    addVec3(scaleVec3(p0, inverse * inverse), scaleVec3(p1, 2 * inverse * u)),
    scaleVec3(p2, u * u),
  );
}

export function quadraticTangent3d(p0, p1, p2, t) {
  const u = clamp01(t);
  return scaleVec3(
    addVec3(
      scaleVec3(subtractVec3(p1, p0), 1 - u),
      scaleVec3(subtractVec3(p2, p1), u),
    ),
    2,
  );
}

export function cubicPoint3d(p0, p1, p2, p3, t) {
  const u = clamp01(t);
  if (u === 0) return cloneVec3(p0);
  if (u === 1) return cloneVec3(p3);
  const inverse = 1 - u;
  return addVec3(
    addVec3(
      scaleVec3(p0, inverse ** 3),
      scaleVec3(p1, 3 * inverse * inverse * u),
    ),
    addVec3(
      scaleVec3(p2, 3 * inverse * u * u),
      scaleVec3(p3, u ** 3),
    ),
  );
}

export function cubicTangent3d(p0, p1, p2, p3, t) {
  const u = clamp01(t);
  const inverse = 1 - u;
  return addVec3(
    addVec3(
      scaleVec3(subtractVec3(p1, p0), 3 * inverse * inverse),
      scaleVec3(subtractVec3(p2, p1), 6 * inverse * u),
    ),
    scaleVec3(subtractVec3(p3, p2), 3 * u * u),
  );
}

function quadraticCenterline(p0, p1, p2, metadata = {}) {
  return {
    kind: "quadratic",
    controlPoints: [cloneVec3(p0), cloneVec3(p1), cloneVec3(p2)],
    ...metadata,
  };
}

function cubicCenterline(p0, p1, p2, p3, metadata = {}) {
  return {
    kind: "cubic",
    controlPoints: [cloneVec3(p0), cloneVec3(p1), cloneVec3(p2), cloneVec3(p3)],
    ...metadata,
  };
}

export function centerlinePoint3d(centerline, t) {
  const points = centerline?.controlPoints ?? [];
  if (centerline?.kind === "quadratic" && points.length === 3) {
    return quadraticPoint3d(points[0], points[1], points[2], t);
  }
  if (centerline?.kind === "cubic" && points.length === 4) {
    return cubicPoint3d(points[0], points[1], points[2], points[3], t);
  }
  throw new Error(`Unknown 3D centerline kind: ${centerline?.kind ?? "undefined"}`);
}

export function centerlineTangent3d(centerline, t) {
  const points = centerline?.controlPoints ?? [];
  if (centerline?.kind === "quadratic" && points.length === 3) {
    return quadraticTangent3d(points[0], points[1], points[2], t);
  }
  if (centerline?.kind === "cubic" && points.length === 4) {
    return cubicTangent3d(points[0], points[1], points[2], points[3], t);
  }
  throw new Error(`Unknown 3D centerline kind: ${centerline?.kind ?? "undefined"}`);
}

export function centerlineUnitTangent3d(centerline, t, fallback = null) {
  const direct = normalizeVec3(centerlineTangent3d(centerline, t));
  if (direct) return direct;

  const u = clamp01(t);
  const delta = 1e-5;
  const before = centerlinePoint3d(centerline, Math.max(0, u - delta));
  const after = centerlinePoint3d(centerline, Math.min(1, u + delta));
  return normalizeVec3(subtractVec3(after, before))
    ?? normalizeVec3(fallback ?? { x: 1, y: 0, z: 0 })
    ?? AXES[0];
}

export function sampleCenterline3d(centerline, segments = 16) {
  const count = Math.max(1, Math.floor(optionNumber(segments, 16, Number.isFinite)));
  return Array.from({ length: count + 1 }, (_, index) =>
    centerlinePoint3d(centerline, index / count));
}

function greenMetadata(role, greenOutwardTangent, extra = {}) {
  if (role !== "start" && role !== "end") throw new Error(`Unknown semantic arc role: ${role}`);
  return {
    role,
    semanticOrientation: role === "start" ? "outer-to-green" : "green-to-outer",
    greenEndpoint: role === "start" ? "target" : "source",
    greenOutwardTangent: cloneVec3(greenOutwardTangent),
    ...extra,
  };
}

// GREEN-касательные здесь всегда направлены наружу от центра связи.
// Для semantic start A -> X производная кривой в X имеет обратный знак.
export function pairedArcControlGeometry3d(
  center,
  startPole,
  endPole,
  tangentLength = DEFAULT_TANGENT_LENGTH,
) {
  const length = Math.max(
    GEOMETRY_EPSILON,
    optionNumber(tangentLength, DEFAULT_TANGENT_LENGTH, (value) => Number.isFinite(value) && value > 0),
  );
  const startVector = subtractVec3(startPole, center);
  const endVector = subtractVec3(endPole, center);
  const startUnit = normalizeVec3(startVector);
  const endUnit = normalizeVec3(endVector);

  let startOutward = normalizeVec3(
    subtractVec3(startUnit ?? { x: 0, y: 0, z: 0 }, endUnit ?? { x: 0, y: 0, z: 0 }),
  );
  if (!startOutward) {
    const fallback = startUnit ?? scaleVec3(endUnit ?? AXES[0], -1);
    startOutward = stableOrthogonalVec3(fallback);
  }
  if (startUnit && dotVec3(startOutward, startVector) < 0) {
    startOutward = scaleVec3(startOutward, -1);
  }

  const endOutward = scaleVec3(startOutward, -1);
  const startControl = addVec3(center, scaleVec3(startOutward, length));
  const endControl = addVec3(center, scaleVec3(endOutward, length));

  return {
    startOutward,
    endOutward,
    start: quadraticCenterline(
      startPole,
      startControl,
      center,
      greenMetadata("start", startOutward),
    ),
    end: quadraticCenterline(
      center,
      endControl,
      endPole,
      greenMetadata("end", endOutward),
    ),
  };
}

export function deterministicLoopPlaneNormal3d(direction, role = "start") {
  if (role !== "start" && role !== "end") throw new Error(`Unknown self-loop role: ${role}`);
  const normal = stableOrthogonalVec3(direction);
  return role === "start" ? normal : scaleVec3(normal, -1);
}

function loopCenterline3d(
  center,
  greenOutward,
  role,
  planeNormal,
  loopRadius,
  handedness,
) {
  const green = normalizeVec3(greenOutward) ?? AXES[0];
  let normal = normalizeVec3(planeNormal) ?? stableOrthogonalVec3(green);
  normal = normalizeVec3(subtractVec3(normal, scaleVec3(green, dotVec3(normal, green))))
    ?? stableOrthogonalVec3(green);
  const side = normalizeVec3(crossVec3(normal, green)) ?? stableOrthogonalVec3(green);
  const sign = handedness < 0 ? -1 : 1;
  const otherRay = normalizeVec3(
    addVec3(scaleVec3(green, -0.35), scaleVec3(side, sign * Math.sqrt(1 - 0.35 ** 2))),
  ) ?? side;
  const radius = Math.max(
    GEOMETRY_EPSILON,
    optionNumber(loopRadius, DEFAULT_LOOP_RADIUS, (value) => Number.isFinite(value) && value > 0),
  );

  let p1;
  let p2;
  if (role === "start") {
    p1 = addVec3(center, scaleVec3(otherRay, radius));
    p2 = addVec3(center, scaleVec3(green, radius));
  } else {
    p1 = addVec3(center, scaleVec3(green, radius));
    p2 = addVec3(center, scaleVec3(otherRay, radius));
  }

  return cubicCenterline(
    center,
    p1,
    p2,
    center,
    greenMetadata(role, green, {
      loop: true,
      planeNormal: cloneVec3(normal),
      handedness: sign,
    }),
  );
}

export function singleSelfLoopGeometry3d(center, companionPole, selfRole, options = {}) {
  if (selfRole !== "start" && selfRole !== "end") {
    throw new Error(`Unknown self-loop role: ${selfRole}`);
  }
  const tangentLength = optionNumber(
    options.tangentLength,
    DEFAULT_TANGENT_LENGTH,
    (value) => Number.isFinite(value) && value > 0,
  );
  const loopRadius = optionNumber(
    options.loopRadius,
    DEFAULT_LOOP_RADIUS,
    (value) => Number.isFinite(value) && value > 0,
  );
  const companionOutward = normalizeVec3(subtractVec3(companionPole, center)) ?? AXES[0];
  const selfOutward = scaleVec3(companionOutward, -1);
  const planeNormal = deterministicLoopPlaneNormal3d(companionOutward, selfRole);
  const selfLoop = loopCenterline3d(
    center,
    selfOutward,
    selfRole,
    planeNormal,
    loopRadius,
    selfRole === "start" ? 1 : -1,
  );
  const companionControl = addVec3(center, scaleVec3(companionOutward, tangentLength));

  const companion = selfRole === "start"
    ? quadraticCenterline(
      center,
      companionControl,
      companionPole,
      greenMetadata("end", companionOutward),
    )
    : quadraticCenterline(
      companionPole,
      companionControl,
      center,
      greenMetadata("start", companionOutward),
    );

  return {
    start: selfRole === "start" ? selfLoop : companion,
    end: selfRole === "start" ? companion : selfLoop,
    companionOutward,
    selfOutward,
    planeNormal,
  };
}

export function doubleSelfLoopGeometry3d(center, options = {}) {
  const loopRadius = optionNumber(
    options.loopRadius,
    DEFAULT_LOOP_RADIUS,
    (value) => Number.isFinite(value) && value > 0,
  );
  const startOutward = { x: -1, y: 0, z: 0 };
  const endOutward = { x: 1, y: 0, z: 0 };
  const startNormal = { x: 0, y: 0, z: 1 };
  const endNormal = { x: 0, y: 0, z: -1 };

  return {
    startOutward,
    endOutward,
    start: loopCenterline3d(center, startOutward, "start", startNormal, loopRadius, 1),
    end: loopCenterline3d(center, endOutward, "end", endNormal, loopRadius, 1),
  };
}

export function semanticLinkGeometry3d({
  center,
  startPole,
  endPole,
  startSelf = false,
  endSelf = false,
}, options = {}) {
  if (startSelf && endSelf) return doubleSelfLoopGeometry3d(center, options);
  if (startSelf) return singleSelfLoopGeometry3d(center, endPole, "start", options);
  if (endSelf) return singleSelfLoopGeometry3d(center, startPole, "end", options);
  return pairedArcControlGeometry3d(
    center,
    startPole,
    endPole,
    options.tangentLength ?? DEFAULT_TANGENT_LENGTH,
  );
}

// 16*t^2*(1-t)^2 даёт a(0)=a(1)=a'(0)=a'(1)=0,
// при этом значение в середине равно coilRadius.
export function springEnvelope3d(t, coilRadius = 1) {
  const u = clamp01(t);
  const radius = optionNumber(coilRadius, 1, Number.isFinite);
  return 16 * radius * u * u * (1 - u) * (1 - u);
}

export function springEnvelopeDerivative3d(t, coilRadius = 1) {
  const u = clamp01(t);
  const radius = optionNumber(coilRadius, 1, Number.isFinite);
  return 32 * radius * u * (1 - u) * (1 - 2 * u);
}

// Детерминированный parallel-transport-подобный frame: предыдущая normal
// проектируется в плоскость новой tangent, без случайного twist.
export function deterministicSpringFrames3d(centerline, parameters) {
  const frameSegments = Math.max(
    2,
    Math.floor(optionNumber(parameters, 16, Number.isFinite)),
  );
  const ts = Array.isArray(parameters)
    ? parameters.map(clamp01)
    : Array.from({ length: frameSegments + 1 }, (_, index) => index / frameSegments);

  let previousNormal = null;
  let previousTangent = AXES[0];
  return ts.map((t) => {
    const tangent = centerlineUnitTangent3d(centerline, t, previousTangent);
    let normal = null;
    if (previousNormal) {
      normal = normalizeVec3(
        subtractVec3(previousNormal, scaleVec3(tangent, dotVec3(previousNormal, tangent))),
      );
    }
    normal ??= stableOrthogonalVec3(tangent);
    if (previousNormal && dotVec3(normal, previousNormal) < 0) {
      normal = scaleVec3(normal, -1);
    }

    const binormal = normalizeVec3(crossVec3(tangent, normal))
      ?? normalizeVec3(crossVec3(tangent, stableOrthogonalVec3(tangent)))
      ?? AXES[2];
    normal = normalizeVec3(crossVec3(binormal, tangent)) ?? normal;

    previousNormal = normal;
    previousTangent = tangent;
    return { t, tangent, normal, binormal };
  });
}

function approximateCenterlineLength3d(centerline, segments = 48) {
  const points = sampleCenterline3d(centerline, segments);
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += normVec3(subtractVec3(points[index], points[index - 1]));
  }
  return length;
}

export function springCurveAroundCenterline3d(centerline, options = {}) {
  const coilRadius = Math.max(
    0,
    optionNumber(options.coilRadius, 0.08, (value) => Number.isFinite(value) && value >= 0),
  );
  let turnCount = optionNumber(
    options.turnCount,
    Number.NaN,
    (value) => Number.isFinite(value) && value !== 0,
  );
  if (!Number.isFinite(turnCount)) {
    const pitch = optionNumber(
      options.pitch,
      Number.NaN,
      (value) => Number.isFinite(value) && value > GEOMETRY_EPSILON,
    );
    turnCount = Number.isFinite(pitch)
      ? Math.max(1, approximateCenterlineLength3d(centerline) / pitch)
      : 5;
  }
  const samplesPerTurn = Math.max(
    4,
    Math.floor(optionNumber(options.samplesPerTurn, 8, (value) => Number.isFinite(value) && value >= 1)),
  );
  const segments = Math.max(
    8,
    Math.floor(optionNumber(
      options.segments,
      Math.ceil(Math.max(1, Math.abs(turnCount)) * samplesPerTurn),
      (value) => Number.isFinite(value) && value >= 1,
    )),
  );
  const phaseOffset = optionNumber(options.phaseOffset, 0, Number.isFinite);
  const ts = Array.from({ length: segments + 1 }, (_, index) => index / segments);
  const frames = deterministicSpringFrames3d(centerline, ts);

  const points = frames.map((frame, index) => {
    const base = centerlinePoint3d(centerline, frame.t);
    if (index === 0 || index === frames.length - 1 || coilRadius === 0) return base;

    const amplitude = springEnvelope3d(frame.t, coilRadius);
    const phase = phaseOffset + TAU * turnCount * frame.t;
    const radial = addVec3(
      scaleVec3(frame.normal, Math.cos(phase)),
      scaleVec3(frame.binormal, Math.sin(phase)),
    );
    return addVec3(base, scaleVec3(radial, amplitude));
  });

  return {
    points,
    frames,
    turnCount,
    coilRadius,
    samplesPerTurn,
    startTangent: centerlineUnitTangent3d(centerline, 0),
    endTangent: centerlineUnitTangent3d(centerline, 1),
    greenOutwardTangent: cloneVec3(centerline.greenOutwardTangent ?? AXES[0]),
  };
}
