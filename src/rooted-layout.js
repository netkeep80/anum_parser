import { projectAsetToVisualLinkNetwork } from "./mts-visual-adapter.js";

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;

// Structural depth is a property of link construction, not of the shortest
// displayed path. Recursive cycles are collapsed first, so a self-link never
// creates an infinite depth. Topology comes only from VisualLinkNetwork.
export function computeStructuralDepths(source, options = {}) {
  const { network, rootKey } = resolveStructuralNetwork(source, options.rootKey);
  return computeNetworkStructuralDepths(network, rootKey);
}

// Converts an arbitrary seed layout into concentric structural layers around
// the root. Seed geometry is used only to preserve a stable angular ordering;
// radius is derived exclusively from structural depth.
export function buildRootedStructuralLayout(source, seedPositions = {}, options = {}) {
  const { network, rootKey } = resolveStructuralNetwork(source, options.rootKey);
  const analysis = computeNetworkStructuralDepths(network, rootKey);
  const known = new Set(Object.keys(analysis.depths));
  const visibleIds = Object.keys(seedPositions)
    .filter((id) => known.has(id) && finitePoint(seedPositions[id]))
    .sort();

  if (visibleIds.length === 0) {
    return {
      positions: {},
      center: { x: 0, y: 0 },
      depths: analysis.depths,
      radii: {},
      layerSpacing: options.layerSpacing ?? 96,
      components: analysis.components,
      projectPosition: (_id, point) => ({ ...point }),
    };
  }

  const center = finitePoint(options.center)
    ? { ...options.center }
    : boundsCenter(seedPositions, visibleIds);
  const minimumNodeSpacing = options.minimumNodeSpacing ?? 58;
  let layerSpacing = options.layerSpacing ?? 96;
  const layers = groupByDepth(visibleIds, analysis.depths);

  // Keep exact r = depth * layerSpacing while scaling the single global spacing
  // enough for every populated ring to carry its nodes without overlap.
  for (const [depth, ids] of layers) {
    if (depth <= 0 || ids.length <= 1) continue;
    const requiredRadius = ids.length * minimumNodeSpacing / TWO_PI;
    layerSpacing = Math.max(layerSpacing, requiredRadius / depth);
  }

  const positions = {};
  const radii = {};
  const fallbackAngles = {};

  for (const [depth, ids] of [...layers.entries()].sort((left, right) => left[0] - right[0])) {
    const radius = depth * layerSpacing;
    const ordered = ids.map((id) => ({
      id,
      angle: seedAngle(center, seedPositions[id], id),
    })).sort((left, right) => left.angle - right.angle || left.id.localeCompare(right.id));

    if (depth === 0) {
      for (const { id } of ordered) {
        positions[id] = { ...center };
        radii[id] = 0;
        fallbackAngles[id] = stableAngle(id);
      }
      continue;
    }

    const step = TWO_PI / ordered.length;
    const phase = bestCircularPhase(ordered, step, depth);
    ordered.forEach(({ id }, index) => {
      const angle = phase + index * step;
      positions[id] = pointAt(center, radius, angle);
      radii[id] = radius;
      fallbackAngles[id] = angle;
    });
  }

  if (rootKey && positions[rootKey]) positions[rootKey] = { ...center };

  return {
    positions,
    center,
    depths: analysis.depths,
    radii,
    layerSpacing,
    components: analysis.components,
    projectPosition: createRadialProjector(center, radii, fallbackAngles),
  };
}

export function createRadialProjector(center, radii, fallbackAngles = {}) {
  const origin = finitePoint(center) ? { ...center } : { x: 0, y: 0 };
  return (id, target) => {
    const radius = radii?.[id];
    if (!Number.isFinite(radius) || !finitePoint(target)) return finitePoint(target) ? { ...target } : { ...origin };
    if (radius <= EPSILON) return { ...origin };

    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const length = Math.hypot(dx, dy);
    const angle = length > EPSILON
      ? Math.atan2(dy, dx)
      : Number.isFinite(fallbackAngles?.[id])
        ? fallbackAngles[id]
        : stableAngle(id);
    return pointAt(origin, radius, angle);
  };
}

export function radialDistance(center, point) {
  if (!finitePoint(center) || !finitePoint(point)) return Number.NaN;
  return Math.hypot(point.x - center.x, point.y - center.y);
}

function resolveStructuralNetwork(source, requestedRootKey) {
  const networkLike = Array.isArray(source?.links)
    && source.links.every((link) => (
      typeof link?.key === "string"
      && typeof link?.startKey === "string"
      && typeof link?.endKey === "string"
    ));
  return {
    network: networkLike ? source : projectAsetToVisualLinkNetwork(source),
    rootKey: requestedRootKey ?? (networkLike ? null : source?.root ?? null),
  };
}

function computeNetworkStructuralDepths(network, rootKey) {
  const links = Array.isArray(network?.links) ? network.links : [];
  const linkById = new Map(
    links
      .filter((link) => typeof link?.key === "string")
      .map((link) => [link.key, link]),
  );
  const ids = [...linkById.keys()].sort();
  const known = new Set(ids);
  const dependenciesById = new Map(ids.map((id) => {
    const link = linkById.get(id);
    const dependencies = [...new Set([link?.startKey, link?.endKey]
      .filter((dependency) => known.has(dependency)))].sort();
    return [id, dependencies];
  }));

  const { components, componentOf } = stronglyConnectedComponents(ids, dependenciesById);
  const componentDependencies = components.map(() => new Set());
  components.forEach((members, componentIndex) => {
    for (const id of members) {
      for (const dependency of dependenciesById.get(id) ?? []) {
        const dependencyComponent = componentOf.get(dependency);
        if (dependencyComponent !== undefined && dependencyComponent !== componentIndex) {
          componentDependencies[componentIndex].add(dependencyComponent);
        }
      }
    }
  });

  const rootComponent = componentOf.get(rootKey);
  const componentDepths = new Array(components.length);
  const depthOfComponent = (componentIndex) => {
    if (componentDepths[componentIndex] !== undefined) return componentDepths[componentIndex];
    if (componentIndex === rootComponent) {
      componentDepths[componentIndex] = 0;
      return 0;
    }

    const dependencyDepths = [...componentDependencies[componentIndex]]
      .sort((left, right) => left - right)
      .map(depthOfComponent);
    const depth = 1 + (dependencyDepths.length > 0 ? Math.max(...dependencyDepths) : 0);
    componentDepths[componentIndex] = depth;
    return depth;
  };

  for (let index = 0; index < components.length; index += 1) depthOfComponent(index);

  const depths = {};
  const componentIds = {};
  components.forEach((members, componentIndex) => {
    const componentId = members.join("|");
    for (const id of members) {
      depths[id] = componentDepths[componentIndex];
      componentIds[id] = componentId;
    }
  });

  return {
    depths,
    componentIds,
    components: components.map((members, index) => ({
      id: members.join("|"),
      members: [...members],
      depth: componentDepths[index],
      dependencyComponents: [...componentDependencies[index]]
        .map((dependencyIndex) => components[dependencyIndex].join("|"))
        .sort(),
      root: index === rootComponent,
    })),
  };
}

function stronglyConnectedComponents(ids, adjacency) {
  let nextIndex = 0;
  const indexById = new Map();
  const lowLinkById = new Map();
  const stack = [];
  const onStack = new Set();
  const rawComponents = [];

  const visit = (id) => {
    indexById.set(id, nextIndex);
    lowLinkById.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    for (const dependency of adjacency.get(id) ?? []) {
      if (!indexById.has(dependency)) {
        visit(dependency);
        lowLinkById.set(id, Math.min(lowLinkById.get(id), lowLinkById.get(dependency)));
      } else if (onStack.has(dependency)) {
        lowLinkById.set(id, Math.min(lowLinkById.get(id), indexById.get(dependency)));
      }
    }

    if (lowLinkById.get(id) !== indexById.get(id)) return;
    const members = [];
    while (stack.length > 0) {
      const member = stack.pop();
      onStack.delete(member);
      members.push(member);
      if (member === id) break;
    }
    rawComponents.push(members.sort());
  };

  for (const id of ids) if (!indexById.has(id)) visit(id);

  const components = rawComponents.sort((left, right) => left[0].localeCompare(right[0]));
  const componentOf = new Map();
  components.forEach((members, index) => {
    for (const id of members) componentOf.set(id, index);
  });
  return { components, componentOf };
}

function groupByDepth(ids, depths) {
  const layers = new Map();
  for (const id of ids) {
    const depth = Number.isInteger(depths[id]) && depths[id] >= 0 ? depths[id] : 1;
    if (!layers.has(depth)) layers.set(depth, []);
    layers.get(depth).push(id);
  }
  for (const layer of layers.values()) layer.sort();
  return layers;
}

function bestCircularPhase(ordered, step, depth) {
  let x = 0;
  let y = 0;
  ordered.forEach((item, index) => {
    const difference = item.angle - index * step;
    x += Math.cos(difference);
    y += Math.sin(difference);
  });
  if (Math.hypot(x, y) > EPSILON) return Math.atan2(y, x);
  return -Math.PI / 2 + (depth % 2 === 0 ? step / 2 : 0);
}

function seedAngle(center, point, id) {
  if (finitePoint(point)) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    if (Math.hypot(dx, dy) > EPSILON) return Math.atan2(dy, dx);
  }
  return stableAngle(id);
}

function stableAngle(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash / 0x100000000 * TWO_PI - Math.PI;
}

function boundsCenter(positions, ids) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const id of ids) {
    const point = positions[id];
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

function pointAt(center, radius, angle) {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}
