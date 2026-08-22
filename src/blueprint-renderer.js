import { buildBlueprintGeometry, createBlueprintInitialPositions } from "./blueprint-geometry.js";
import { SEMANTIC_COLORS } from "./visual-model.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_SCALE = 0.1;
const MAX_SCALE = 20;
const DEFAULT_PADDING = 36;
const instances = new WeakMap();

export function createBlueprintRenderer(container, visualModel, options = {}) {
  if (!container) throw new Error("Blueprint renderer requires a container");
  destroyBlueprintRenderer(container);

  const state = {
    container,
    visualModel,
    positions: clonePositions(options.positions ?? createBlueprintInitialPositions(visualModel)),
    selectedLinkId: options.selectedLinkId ?? null,
    debugState: options.debugState ?? null,
    onSelectLink: typeof options.onSelectLink === "function" ? options.onSelectLink : null,
    scale: 1,
    panX: 0,
    panY: 0,
    drag: null,
    panDrag: null,
    listeners: [],
    destroyed: false,
  };

  const svg = svgElement("svg", {
    class: "blueprint-svg",
    role: "img",
    "aria-label": "Blueprint-визуализация асети связей",
    tabindex: "0",
    "data-role": "blueprint-svg",
  });
  const defs = svgElement("defs");
  const viewport = svgElement("g", { "data-role": "blueprint-viewport" });
  const curvesLayer = svgElement("g", { "data-role": "blueprint-curves" });
  const centersLayer = svgElement("g", { "data-role": "blueprint-centers" });
  const labelsLayer = svgElement("g", { "data-role": "blueprint-labels" });
  viewport.append(curvesLayer, centersLayer, labelsLayer);
  svg.append(defs, viewport);
  container.replaceChildren(svg);
  state.svg = svg;
  state.defs = defs;
  state.viewport = viewport;
  state.curvesLayer = curvesLayer;
  state.centersLayer = centersLayer;
  state.labelsLayer = labelsLayer;
  instances.set(container, state);

  installInteraction(state);
  redraw(state);
  fitBlueprintRenderer(container);
  return snapshot(state);
}

export function destroyBlueprintRenderer(container) {
  const state = instances.get(container);
  if (!state) {
    container?.querySelector?.('[data-role="blueprint-svg"]')?.remove();
    return false;
  }
  state.destroyed = true;
  for (const [target, type, listener, options] of state.listeners) {
    target.removeEventListener(type, listener, options);
  }
  state.listeners.length = 0;
  state.svg?.remove();
  instances.delete(container);
  return true;
}

export function hasBlueprintRenderer(container) {
  return instances.has(container);
}

export function fitBlueprintRenderer(container, padding = DEFAULT_PADDING) {
  const state = requireState(container);
  redraw(state);
  const points = state.geometry.links.flatMap((link) => link.pathPoints);
  if (points.length === 0) {
    state.scale = 1;
    state.panX = container.clientWidth / 2;
    state.panY = container.clientHeight / 2;
    applyViewportTransform(state);
    return snapshot(state);
  }

  const bounds = boundsOf(points);
  const width = Math.max(1, container.clientWidth || 1);
  const height = Math.max(1, container.clientHeight || 1);
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  state.scale = clamp(Math.min(availableWidth / contentWidth, availableHeight / contentHeight), MIN_SCALE, MAX_SCALE);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  state.panX = width / 2 - centerX * state.scale;
  state.panY = height / 2 - centerY * state.scale;
  applyViewportTransform(state);
  return snapshot(state);
}

export function zoomBlueprintRenderer(container, factor, anchor = null) {
  const state = requireState(container);
  const oldScale = state.scale;
  const nextScale = clamp(oldScale * Number(factor || 1), MIN_SCALE, MAX_SCALE);
  if (nextScale === oldScale) return snapshot(state);
  const width = Math.max(1, container.clientWidth || 1);
  const height = Math.max(1, container.clientHeight || 1);
  const x = Number.isFinite(anchor?.x) ? anchor.x : width / 2;
  const y = Number.isFinite(anchor?.y) ? anchor.y : height / 2;
  const worldX = (x - state.panX) / oldScale;
  const worldY = (y - state.panY) / oldScale;
  state.scale = nextScale;
  state.panX = x - worldX * nextScale;
  state.panY = y - worldY * nextScale;
  applyViewportTransform(state);
  return snapshot(state);
}

export function setBlueprintSelectedLink(container, linkId) {
  const state = instances.get(container);
  if (!state) return false;
  state.selectedLinkId = linkId ?? null;
  updatePresentation(state);
  return true;
}

export function setBlueprintDebugState(container, debugState) {
  const state = instances.get(container);
  if (!state) return false;
  state.debugState = debugState ?? null;
  updatePresentation(state);
  return true;
}

export function getBlueprintRendererSnapshot(container) {
  const state = instances.get(container);
  return state ? snapshot(state) : null;
}

export function setBlueprintPosition(container, linkId, position) {
  const state = requireState(container);
  if (!state.positions[linkId] || !finitePoint(position)) return false;
  state.positions[linkId] = { x: Number(position.x), y: Number(position.y) };
  redraw(state);
  return true;
}

function redraw(state) {
  if (state.destroyed) return;
  state.geometry = buildBlueprintGeometry(state.visualModel, state.positions);
  state.defs.replaceChildren(createArrowMarker());
  state.curvesLayer.replaceChildren();
  state.centersLayer.replaceChildren();
  state.labelsLayer.replaceChildren();

  for (const link of state.geometry.links) {
    const group = svgElement("g", {
      "data-role": "blueprint-link",
      "data-link-id": link.linkId,
    });
    const startGradientId = safeId(`blueprint-start-${link.linkId}`);
    const endGradientId = safeId(`blueprint-end-${link.linkId}`);
    state.defs.append(
      linearGradient(startGradientId, SEMANTIC_COLORS.start, SEMANTIC_COLORS.center),
      linearGradient(endGradientId, SEMANTIC_COLORS.center, SEMANTIC_COLORS.end),
    );
    const startPath = svgElement("path", {
      d: link.startPath,
      class: "blueprint-curve blueprint-start-curve",
      stroke: `url(#${startGradientId})`,
      fill: "none",
      "data-role": "blueprint-start-path",
    });
    const endPath = svgElement("path", {
      d: link.endPath,
      class: "blueprint-curve blueprint-end-curve",
      stroke: `url(#${endGradientId})`,
      fill: "none",
      "marker-end": "url(#blueprint-end-arrow)",
      "data-role": "blueprint-end-path",
    });
    group.append(startPath, endPath);
    state.curvesLayer.append(group);

    const centerGroup = svgElement("g", {
      class: "blueprint-center-group",
      transform: `translate(${link.center.x} ${link.center.y})`,
      "data-role": "blueprint-center",
      "data-link-id": link.linkId,
      tabindex: "0",
    });
    const halo = svgElement("circle", { r: 13, class: "blueprint-center-halo" });
    const center = svgElement("circle", {
      r: link.root ? 8 : 6.5,
      class: `blueprint-center-dot${link.root ? " root" : ""}`,
      fill: SEMANTIC_COLORS.center,
    });
    centerGroup.append(halo, center);
    state.centersLayer.append(centerGroup);

    const label = svgElement("text", {
      x: link.center.x + 11,
      y: link.center.y - 11,
      class: "blueprint-label",
      "data-role": "blueprint-label",
      "data-link-id": link.linkId,
    });
    label.textContent = link.label ?? link.linkId;
    state.labelsLayer.append(label);
  }
  applyViewportTransform(state);
  updatePresentation(state);
}

function updatePresentation(state) {
  const visibleIds = state.debugState?.visibleLinkIds;
  const visibleSet = Array.isArray(visibleIds) ? new Set(visibleIds) : null;
  const produced = new Set(state.debugState?.producedLinks ?? []);
  const reused = new Set(state.debugState?.reusedLinks ?? []);

  for (const element of state.svg.querySelectorAll("[data-link-id]")) {
    const id = element.getAttribute("data-link-id");
    const selected = id === state.selectedLinkId;
    element.classList.toggle("blueprint-selected", selected);
    element.classList.toggle("blueprint-debug-hidden", Boolean(visibleSet && !visibleSet.has(id)));
    element.classList.toggle("blueprint-debug-produced", produced.has(id));
    element.classList.toggle("blueprint-debug-reused", reused.has(id));
  }
}

function installInteraction(state) {
  listen(state, state.svg, "pointerdown", (event) => {
    const center = event.target.closest?.('[data-role="blueprint-center"]');
    if (center) {
      const linkId = center.getAttribute("data-link-id");
      if (!state.positions[linkId]) return;
      event.preventDefault();
      event.stopPropagation();
      state.svg.setPointerCapture?.(event.pointerId);
      state.drag = { pointerId: event.pointerId, linkId };
      select(state, linkId);
      moveDraggedCenter(state, event);
      return;
    }
    event.preventDefault();
    state.svg.setPointerCapture?.(event.pointerId);
    state.panDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: state.panX,
      panY: state.panY,
    };
  });

  listen(state, state.svg, "pointermove", (event) => {
    if (state.drag?.pointerId === event.pointerId) {
      event.preventDefault();
      moveDraggedCenter(state, event);
      return;
    }
    if (state.panDrag?.pointerId === event.pointerId) {
      event.preventDefault();
      state.panX = state.panDrag.panX + event.clientX - state.panDrag.startX;
      state.panY = state.panDrag.panY + event.clientY - state.panDrag.startY;
      applyViewportTransform(state);
    }
  });

  const release = (event) => {
    if (state.drag?.pointerId === event.pointerId) state.drag = null;
    if (state.panDrag?.pointerId === event.pointerId) state.panDrag = null;
    state.svg.releasePointerCapture?.(event.pointerId);
  };
  listen(state, state.svg, "pointerup", release);
  listen(state, state.svg, "pointercancel", release);

  listen(state, state.svg, "wheel", (event) => {
    event.preventDefault();
    const rect = state.svg.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomBlueprintRenderer(state.container, factor, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }, { passive: false });

  listen(state, state.svg, "click", (event) => {
    const target = event.target.closest?.("[data-link-id]");
    if (target) select(state, target.getAttribute("data-link-id"));
  });

  listen(state, state.svg, "keydown", (event) => {
    const target = event.target.closest?.('[data-role="blueprint-center"]');
    if (!target || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    select(state, target.getAttribute("data-link-id"));
  });
}

function moveDraggedCenter(state, event) {
  const rect = state.svg.getBoundingClientRect();
  const x = (event.clientX - rect.left - state.panX) / state.scale;
  const y = (event.clientY - rect.top - state.panY) / state.scale;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  state.positions[state.drag.linkId] = { x, y };
  redraw(state);
}

function select(state, linkId) {
  state.selectedLinkId = linkId ?? null;
  updatePresentation(state);
  state.onSelectLink?.(state.selectedLinkId);
}

function applyViewportTransform(state) {
  state.viewport.setAttribute("transform", `translate(${state.panX} ${state.panY}) scale(${state.scale})`);
}

function createArrowMarker() {
  const marker = svgElement("marker", {
    id: "blueprint-end-arrow",
    viewBox: "0 0 10 10",
    refX: "8.5",
    refY: "5",
    markerWidth: "8",
    markerHeight: "8",
    orient: "auto-start-reverse",
    markerUnits: "strokeWidth",
  });
  marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: SEMANTIC_COLORS.end }));
  return marker;
}

function linearGradient(id, from, to) {
  const gradient = svgElement("linearGradient", { id, x1: "0%", y1: "0%", x2: "100%", y2: "0%" });
  gradient.append(
    svgElement("stop", { offset: "0%", "stop-color": from }),
    svgElement("stop", { offset: "100%", "stop-color": to }),
  );
  return gradient;
}

function snapshot(state) {
  return {
    positions: clonePositions(state.positions),
    selectedLinkId: state.selectedLinkId,
    scale: state.scale,
    pan: { x: state.panX, y: state.panY },
    linkCount: state.geometry?.links?.length ?? 0,
    svgCount: state.container.querySelectorAll?.('[data-role="blueprint-svg"]').length ?? 0,
    centerCount: state.container.querySelectorAll?.('[data-role="blueprint-center"]').length ?? 0,
    pathCount: state.container.querySelectorAll?.(".blueprint-curve").length ?? 0,
  };
}

function requireState(container) {
  const state = instances.get(container);
  if (!state) throw new Error("Blueprint renderer is not active");
  return state;
}

function listen(state, target, type, listener, options) {
  target.addEventListener(type, listener, options);
  state.listeners.push([target, type, listener, options]);
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function boundsOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function clonePositions(positions) {
  return Object.fromEntries(Object.entries(positions ?? {}).map(([id, point]) => [id, { x: Number(point.x), y: Number(point.y) }]));
}

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, (character) => `_${character.codePointAt(0).toString(16)}_`);
}
