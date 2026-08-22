import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  addVec3,
  normVec3,
  normalizeVec3,
  scaleVec3,
  semanticLinkGeometry3d,
  springCurveAroundCenterline3d,
  subtractVec3,
} from "./geometry3d.js";
import {
  auditReadability3d,
  buildLodPlan3d,
  buildPerformanceBudget3d,
} from "./readability3d.js";
import {
  normalizeVisualDebugState,
  visualDebugFlags,
} from "./visual-model.js";

const rendererStates = new WeakMap();
const DEFAULT_BACKGROUND = 0x08101d;
const DEFAULT_NODE_RADIUS = 0.12;
const DEFAULT_ROOT_SCALE = 1.45;
const DEFAULT_COIL_RADIUS = 0.055;
const DEFAULT_PITCH = 0.28;
const DEFAULT_SAMPLES_PER_TURN = 8;
const DEFAULT_ARROW_RADIUS = 0.075;
const DEFAULT_ARROW_LENGTH = 0.22;
const DEFAULT_CAMERA_FOV = 50;
const POINTER_TAP_DISTANCE = 6;
const HALO_COLORS = Object.freeze({
  current: 0xffd166,
  selected: 0xffffff,
  reused: 0x73a7ff,
  hovered: 0xdde7f5,
});

function cloneVec3(point) {
  return { x: point.x, y: point.y, z: point.z };
}

function fallbackPole(center, companion = null, sign = 1) {
  const direction = companion
    ? normalizeVec3(subtractVec3(companion, center))
    : null;
  const unit = direction ?? { x: 1, y: 0, z: 0 };
  return addVec3(center, scaleVec3(unit, sign));
}

function arcByRole(arcs, linkId, role) {
  return arcs.find((arc) => arc.linkId === linkId && arc.role === role) ?? null;
}

function physicalPositions(physicalState) {
  return physicalState?.positions ?? {};
}

function physicalSpringIds(physicalState) {
  return new Set((physicalState?.physicalModel?.springs ?? []).map((spring) => spring.arcId));
}

export function buildThreeSceneData(visualModel, physicalState, options = {}) {
  const positions = physicalPositions(physicalState);
  const arcs = Array.isArray(visualModel?.arcs) ? visualModel.arcs : [];
  const forceSpringIds = physicalSpringIds(physicalState);
  const nodes = [];
  const renderedArcs = [];

  for (const node of visualModel?.nodes ?? []) {
    const center = positions[node.id];
    if (!center) continue;
    nodes.push({
      id: node.id,
      linkId: node.linkId,
      label: node.label,
      root: Boolean(node.root),
      position: cloneVec3(center),
      color: node.semanticColor,
      radius: (options.nodeRadius ?? DEFAULT_NODE_RADIUS)
        * (node.root ? (options.rootScale ?? DEFAULT_ROOT_SCALE) : 1),
    });

    const startArc = arcByRole(arcs, node.linkId, "start");
    const endArc = arcByRole(arcs, node.linkId, "end");
    if (!startArc && !endArc) continue;

    const actualStartPole = startArc ? positions[startArc.semanticSource] : null;
    const actualEndPole = endArc ? positions[endArc.semanticTarget] : null;
    const startSelf = Boolean(startArc && startArc.semanticSource === startArc.semanticTarget);
    const endSelf = Boolean(endArc && endArc.semanticSource === endArc.semanticTarget);

    const startPole = actualStartPole
      ?? fallbackPole(center, actualEndPole, -1);
    const endPole = actualEndPole
      ?? fallbackPole(center, actualStartPole, -1);
    const geometry = semanticLinkGeometry3d({
      center,
      startPole,
      endPole,
      startSelf,
      endSelf,
    }, {
      tangentLength: options.tangentLength,
      loopRadius: options.loopRadius,
    });

    for (const [arc, centerline] of [[startArc, geometry.start], [endArc, geometry.end]]) {
      if (!arc || !centerline) continue;
      const spring = springCurveAroundCenterline3d(centerline, {
        coilRadius: options.coilRadius ?? DEFAULT_COIL_RADIUS,
        pitch: options.pitch ?? DEFAULT_PITCH,
        samplesPerTurn: options.samplesPerTurn ?? DEFAULT_SAMPLES_PER_TURN,
      });
      renderedArcs.push({
        id: arc.id,
        arcId: arc.id,
        linkId: arc.linkId,
        role: arc.role,
        self: arc.semanticSource === arc.semanticTarget,
        forceSpring: forceSpringIds.has(arc.id),
        semanticSource: arc.semanticSource,
        semanticTarget: arc.semanticTarget,
        colorFrom: arc.colorFrom,
        colorTo: arc.colorTo,
        arrow: arc.arrow,
        points: spring.points.map(cloneVec3),
        greenOutwardTangent: cloneVec3(spring.greenOutwardTangent),
        startTangent: cloneVec3(spring.startTangent),
        endTangent: cloneVec3(spring.endTangent),
      });
    }
  }

  return {
    rootId: visualModel?.rootId ?? null,
    nodes,
    arcs: renderedArcs,
    forceSpringArcIds: [...forceSpringIds],
  };
}

export function buildThreePresentationState(
  visualModel,
  debugState = null,
  selectedLinkId = null,
  hoveredLinkId = null,
) {
  const normalized = normalizeVisualDebugState(visualModel, debugState);
  const nodeStates = [];
  const visibleIds = new Set(normalized.visibleLinkIds);

  for (const node of visualModel?.nodes ?? []) {
    const flags = visualDebugFlags(normalized, node.linkId);
    const selected = selectedLinkId === node.linkId;
    const hovered = hoveredLinkId === node.linkId;
    const halo = flags.current
      ? "current"
      : selected
        ? "selected"
        : flags.reused
          ? "reused"
          : hovered
            ? "hovered"
            : null;
    const scale = flags.current
      ? 1.35
      : selected
        ? 1.25
        : flags.produced
          ? 1.16
          : 1;
    nodeStates.push({
      linkId: node.linkId,
      visible: flags.visible,
      produced: flags.produced,
      reused: flags.reused,
      current: flags.current,
      selected,
      hovered,
      scale,
      halo,
      labelVisible: flags.visible && (node.root || flags.current || selected || hovered),
    });
  }

  const arcStates = (visualModel?.arcs ?? []).map((arc) => ({
    arcId: arc.id,
    visible: visibleIds.has(arc.semanticSource) && visibleIds.has(arc.semanticTarget),
  }));

  return { debugState: normalized, nodes: nodeStates, arcs: arcStates };
}

export function resolvePickedLinkId3d(intersections) {
  for (const intersection of intersections ?? []) {
    const object = intersection?.object;
    if (object?.userData?.kind !== "link-center") continue;
    if (object.userData.linkId != null) return object.userData.linkId;
  }
  return null;
}

export function lodArcSampleIndices3d(
  pointCount,
  samplesPerTurn,
  baseSamplesPerTurn = DEFAULT_SAMPLES_PER_TURN,
) {
  const count = Math.max(0, Math.floor(Number(pointCount) || 0));
  if (count === 0) return [];
  if (count === 1) return [0];
  const requested = Math.max(1, Math.floor(Number(samplesPerTurn) || 1));
  const base = Math.max(1, Math.floor(Number(baseSamplesPerTurn) || DEFAULT_SAMPLES_PER_TURN));
  const stride = Math.max(1, Math.ceil(base / requested));
  const indices = [0];
  for (let index = stride; index < count - 1; index += stride) indices.push(index);
  if (indices.at(-1) !== count - 1) indices.push(count - 1);
  return indices;
}

function threeVector(point) {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function sphereGeometry(node, segments = 16) {
  const widthSegments = Math.max(6, Math.floor(segments));
  const heightSegments = Math.max(4, Math.floor(widthSegments * 0.75));
  return new THREE.SphereGeometry(node.radius, widthSegments, heightSegments);
}

function addNodeMesh(scene, node, options) {
  const geometry = sphereGeometry(node, options.nodeSegments ?? 16);
  const material = new THREE.MeshBasicMaterial({ color: node.color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(threeVector(node.position));
  mesh.userData = { kind: "link-center", linkId: node.linkId, root: node.root, lodTier: null };
  scene.add(mesh);

  let rootHalo = null;
  if (node.root) {
    const haloGeometry = new THREE.SphereGeometry(
      node.radius * (options.rootHaloScale ?? 1.55),
      16,
      12,
    );
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: node.color,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
    });
    rootHalo = new THREE.Mesh(haloGeometry, haloMaterial);
    rootHalo.position.copy(mesh.position);
    rootHalo.userData = { kind: "root-halo", linkId: node.linkId };
    scene.add(rootHalo);
  }

  const debugGeometry = new THREE.SphereGeometry(node.radius * 1.75, 16, 12);
  const debugMaterial = new THREE.MeshBasicMaterial({
    color: HALO_COLORS.current,
    wireframe: true,
    transparent: true,
    opacity: 0.8,
    depthTest: true,
  });
  const debugHalo = new THREE.Mesh(debugGeometry, debugMaterial);
  debugHalo.position.copy(mesh.position);
  debugHalo.visible = false;
  debugHalo.userData = { kind: "debug-halo", linkId: node.linkId };
  scene.add(debugHalo);

  return { mesh, rootHalo, debugHalo };
}

function arcGeometry(arc, indices = null) {
  const selectedIndices = indices ?? arc.points.map((_, index) => index);
  const points = selectedIndices.map((index) => threeVector(arc.points[index]));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const from = new THREE.Color(arc.colorFrom);
  const to = new THREE.Color(arc.colorTo);
  const denominator = Math.max(1, arc.points.length - 1);
  const colors = [];
  for (const index of selectedIndices) {
    const color = from.clone().lerp(to, index / denominator);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function addArcLine(scene, arc) {
  if (arc.points.length < 2) return null;
  const geometry = arcGeometry(arc);
  const material = new THREE.LineBasicMaterial({ vertexColors: true });
  const line = new THREE.Line(geometry, material);
  line.userData = {
    kind: "semantic-spring",
    arcId: arc.arcId,
    linkId: arc.linkId,
    role: arc.role,
    self: arc.self,
    forceSpring: arc.forceSpring,
    lodTier: null,
  };
  scene.add(line);
  return line;
}

function replaceArcLineGeometry(line, arc, samplesPerTurn) {
  const indices = lodArcSampleIndices3d(
    arc.points.length,
    samplesPerTurn,
    DEFAULT_SAMPLES_PER_TURN,
  );
  const geometry = arcGeometry(arc, indices);
  line.geometry.dispose();
  line.geometry = geometry;
}

function replaceNodeGeometry(mesh, node, nodeSegments) {
  const geometry = sphereGeometry(node, nodeSegments);
  mesh.geometry.dispose();
  mesh.geometry = geometry;
}

function addEndArrow(scene, arc, options) {
  if (arc.role !== "end" || arc.arrow !== "target" || arc.points.length === 0) return null;
  const endpoint = arc.points.at(-1);
  const direction = normalizeVec3(arc.endTangent);
  if (!direction || normVec3(direction) === 0) return null;

  const radius = options.arrowRadius ?? DEFAULT_ARROW_RADIUS;
  const length = options.arrowLength ?? DEFAULT_ARROW_LENGTH;
  const geometry = new THREE.ConeGeometry(radius, length, 12);
  const material = new THREE.MeshBasicMaterial({ color: arc.colorTo });
  const arrow = new THREE.Mesh(geometry, material);
  const unit = threeVector(direction).normalize();
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), unit);
  arrow.position.copy(threeVector(endpoint).addScaledVector(unit, -length / 2));
  arrow.userData = { kind: "end-arrow", arcId: arc.arcId, linkId: arc.linkId };
  scene.add(arrow);
  return arrow;
}

function createLabelLayer(container) {
  if (!container.style.position) container.style.position = "relative";
  const layer = document.createElement("div");
  Object.assign(layer.style, {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "2",
  });
  layer.dataset.role = "three-label-layer";
  return layer;
}

function createNodeLabel(node) {
  const label = document.createElement("div");
  label.textContent = node.label ?? node.linkId;
  label.dataset.linkId = node.linkId;
  Object.assign(label.style, {
    position: "absolute",
    display: "none",
    maxWidth: "220px",
    padding: "2px 5px",
    borderRadius: "5px",
    color: "#eef6ff",
    background: "rgba(5, 13, 25, 0.82)",
    border: "1px solid rgba(103, 232, 179, 0.45)",
    fontSize: "11px",
    lineHeight: "1.2",
    whiteSpace: "pre",
    transform: "translate(-50%, -115%)",
    userSelect: "none",
  });
  return label;
}

function disposeObject(object) {
  object.geometry?.dispose?.();
  if (Array.isArray(object.material)) {
    for (const material of object.material) material.dispose?.();
  } else {
    object.material?.dispose?.();
  }
}

function viewportSize(container) {
  return {
    width: Math.max(1, container.clientWidth || container.getBoundingClientRect?.().width || 1),
    height: Math.max(1, container.clientHeight || container.getBoundingClientRect?.().height || 1),
  };
}

function updateLabelPositions(state) {
  const { width, height } = viewportSize(state.container);
  for (const node of state.data.nodes) {
    const label = state.labels.get(node.linkId);
    const mesh = state.nodeMeshes.get(node.linkId);
    if (!label || !mesh || label.style.display === "none" || !mesh.visible) continue;
    const projected = mesh.position.clone().project(state.camera);
    const onScreen = projected.z >= -1 && projected.z <= 1
      && projected.x >= -1.15 && projected.x <= 1.15
      && projected.y >= -1.15 && projected.y <= 1.15;
    label.style.visibility = onScreen ? "visible" : "hidden";
    label.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
    label.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
  }
}

function renderState(state) {
  state.renderer.render(state.scene, state.camera);
  updateLabelPositions(state);
}

function lodDistancesByLinkId(state) {
  return Object.fromEntries(state.data.nodes.map((node) => {
    const mesh = state.nodeMeshes.get(node.linkId);
    return [
      node.linkId,
      mesh ? mesh.position.distanceTo(state.camera.position) : Infinity,
    ];
  }));
}

function applyThreeLodState(state) {
  const presentation = state.presentation ?? buildThreePresentationState(
    state.visualModel,
    state.debugState,
    state.selectedLinkId,
    state.hoveredLinkId,
  );
  const plan = buildLodPlan3d(
    state.data,
    presentation,
    lodDistancesByLinkId(state),
    state.options.lod,
  );
  const nodePlan = new Map(plan.nodes.map((node) => [node.linkId, node]));
  const arcPlan = new Map(plan.arcs.map((arc) => [arc.arcId, arc]));
  const nodePresentation = new Map(presentation.nodes.map((node) => [node.linkId, node]));

  for (const node of state.data.nodes) {
    const current = nodePlan.get(node.linkId);
    const mesh = state.nodeMeshes.get(node.linkId);
    if (current && mesh && mesh.userData.lodTier !== current.tier) {
      replaceNodeGeometry(mesh, node, current.nodeSegments);
      mesh.userData.lodTier = current.tier;
    }
    const label = state.labels.get(node.linkId);
    const presentationNode = nodePresentation.get(node.linkId);
    if (label && current && presentationNode) {
      label.style.display = presentationNode.visible
        && (presentationNode.labelVisible || current.showLabel)
        ? "block"
        : "none";
    }
  }

  for (const arc of state.data.arcs) {
    const current = arcPlan.get(arc.arcId);
    const line = state.arcLines.get(arc.arcId);
    if (!current || !line || line.userData.lodTier === current.tier) continue;
    replaceArcLineGeometry(line, arc, current.samplesPerTurn);
    line.userData.lodTier = current.tier;
  }

  state.lodPlan = plan;
  return plan;
}

function applyThreePresentationState(state) {
  const presentation = buildThreePresentationState(
    state.visualModel,
    state.debugState,
    state.selectedLinkId,
    state.hoveredLinkId,
  );
  const nodeStates = new Map(presentation.nodes.map((node) => [node.linkId, node]));
  const arcStates = new Map(presentation.arcs.map((arc) => [arc.arcId, arc]));

  for (const node of state.data.nodes) {
    const current = nodeStates.get(node.linkId);
    const mesh = state.nodeMeshes.get(node.linkId);
    const rootHalo = state.rootHalos.get(node.linkId);
    const debugHalo = state.debugHalos.get(node.linkId);
    const label = state.labels.get(node.linkId);
    if (!current || !mesh) continue;

    mesh.visible = current.visible;
    mesh.scale.setScalar(current.scale);
    if (rootHalo) rootHalo.visible = current.visible;
    if (debugHalo) {
      debugHalo.visible = current.visible && Boolean(current.halo);
      if (current.halo) debugHalo.material.color.setHex(HALO_COLORS[current.halo]);
      debugHalo.scale.setScalar(current.current ? 1.12 : 1);
    }
    if (label) label.style.display = current.labelVisible ? "block" : "none";
  }

  for (const arc of state.data.arcs) {
    const visible = arcStates.get(arc.arcId)?.visible ?? false;
    const line = state.arcLines.get(arc.arcId);
    const arrow = state.arrows.get(arc.arcId);
    if (line) line.visible = visible;
    if (arrow) arrow.visible = visible;
  }

  state.presentation = presentation;
  applyThreeLodState(state);
  renderState(state);
  return presentation;
}

function configureControls(state) {
  const controls = new OrbitControls(state.camera, state.renderer.domElement);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.2;
  controls.maxDistance = 500;
  state.renderer.domElement.style.touchAction = "none";
  const onChange = () => {
    applyThreeLodState(state);
    renderState(state);
  };
  controls.addEventListener("change", onChange);
  state.controls = controls;
  state.controlsChangeListener = onChange;
}

function pointerCoordinates(state, event) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    y: -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
  };
}

function pickLinkId(state, event) {
  const pointer = pointerCoordinates(state, event);
  state.pointer.set(pointer.x, pointer.y);
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const candidates = [...state.nodeMeshes.values()].filter((mesh) => mesh.visible);
  return resolvePickedLinkId3d(state.raycaster.intersectObjects(candidates, false));
}

function configurePicking(state) {
  const canvas = state.renderer.domElement;
  const onPointerDown = (event) => {
    state.pointerDown = { x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event) => {
    const next = pickLinkId(state, event);
    if (next === state.hoveredLinkId) return;
    state.hoveredLinkId = next;
    applyThreePresentationState(state);
  };
  const onPointerLeave = () => {
    state.pointerDown = null;
    if (state.hoveredLinkId == null) return;
    state.hoveredLinkId = null;
    applyThreePresentationState(state);
  };
  const onPointerUp = (event) => {
    const down = state.pointerDown;
    state.pointerDown = null;
    if (!down) return;
    const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (distance > POINTER_TAP_DISTANCE) return;
    const selected = pickLinkId(state, event);
    state.selectedLinkId = selected;
    applyThreePresentationState(state);
    state.options.onSelectLink?.(selected);
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerup", onPointerUp);
  state.pointerListeners = { onPointerDown, onPointerMove, onPointerLeave, onPointerUp };
}

export function resize3dRenderer(container) {
  const state = rendererStates.get(container);
  if (!state) return false;
  const { width, height } = viewportSize(container);
  state.renderer.setSize(width, height, false);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  renderState(state);
  return true;
}

export function fit3dRenderer(container) {
  const state = rendererStates.get(container);
  if (!state) return false;
  const bounds = new THREE.Box3().setFromObject(state.scene);
  if (bounds.isEmpty()) {
    state.target.set(0, 0, 0);
    state.camera.position.set(0, 0, 4);
  } else {
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(0.5, sphere.radius);
    const fov = THREE.MathUtils.degToRad(state.camera.fov);
    const distance = radius / Math.tan(fov / 2) * 1.35;
    const direction = new THREE.Vector3(1.1, 0.82, 1.35).normalize();
    state.target.copy(sphere.center);
    state.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    state.camera.near = Math.max(0.01, distance / 200);
    state.camera.far = Math.max(100, distance * 20);
    state.camera.updateProjectionMatrix();
  }
  state.controls?.target.copy(state.target);
  state.controls?.update();
  state.camera.lookAt(state.target);
  applyThreeLodState(state);
  renderState(state);
  return true;
}

export function reset3dRenderer(container) {
  return fit3dRenderer(container);
}

export function zoom3dRenderer(container, factor) {
  const state = rendererStates.get(container);
  if (!state || !Number.isFinite(factor) || factor <= 0) return false;
  const offset = state.camera.position.clone().sub(state.target);
  const nextDistance = Math.max(0.25, Math.min(500, offset.length() / factor));
  offset.setLength(nextDistance);
  state.camera.position.copy(state.target).add(offset);
  state.controls?.target.copy(state.target);
  state.controls?.update();
  state.camera.lookAt(state.target);
  applyThreeLodState(state);
  renderState(state);
  return true;
}

export function set3dDebugState(container, debugState) {
  const state = rendererStates.get(container);
  if (!state) return null;
  state.debugState = debugState;
  return applyThreePresentationState(state);
}

export function set3dSelectedLink(container, linkId) {
  const state = rendererStates.get(container);
  if (!state) return false;
  state.selectedLinkId = state.nodeMeshes.has(linkId) ? linkId : null;
  applyThreePresentationState(state);
  return true;
}

export function get3dSelectedLink(container) {
  return rendererStates.get(container)?.selectedLinkId ?? null;
}

export function get3dPerformanceSnapshot(container) {
  const state = rendererStates.get(container);
  if (!state) return null;
  const renderedArcVertices = [...state.arcLines.values()].reduce(
    (sum, line) => sum + (line.geometry.getAttribute("position")?.count ?? 0),
    0,
  );
  return structuredClone({
    readabilityAudit: state.readabilityAudit,
    performanceBudget: state.performanceBudget,
    lodPlan: state.lodPlan,
    renderedArcVertices,
  });
}

export function create3dRenderer(container, visualModel, physicalState, options = {}) {
  destroy3dRenderer(container);
  const data = buildThreeSceneData(visualModel, physicalState, options);
  const readabilityAudit = auditReadability3d(
    physicalPositions(physicalState),
    data,
    options.readability,
  );
  const performanceBudget = buildPerformanceBudget3d({
    visualModel,
    physicalState,
    sceneData: data,
    readabilityAudit,
  }, options.budgets);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(options.background ?? DEFAULT_BACKGROUND);

  const nodeMeshes = new Map();
  const rootHalos = new Map();
  const debugHalos = new Map();
  const arcLines = new Map();
  const arrows = new Map();
  const labels = new Map();

  for (const node of data.nodes) {
    const objects = addNodeMesh(scene, node, options);
    nodeMeshes.set(node.linkId, objects.mesh);
    if (objects.rootHalo) rootHalos.set(node.linkId, objects.rootHalo);
    debugHalos.set(node.linkId, objects.debugHalo);
  }
  for (const arc of data.arcs) {
    const line = addArcLine(scene, arc);
    const arrow = addEndArrow(scene, arc, options);
    if (line) arcLines.set(arc.arcId, line);
    if (arrow) arrows.set(arc.arcId, arrow);
  }

  const camera = new THREE.PerspectiveCamera(
    options.fov ?? DEFAULT_CAMERA_FOV,
    1,
    0.01,
    500,
  );
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = "block";

  const labelLayer = createLabelLayer(container);
  for (const node of data.nodes) {
    const label = createNodeLabel(node);
    labels.set(node.linkId, label);
    labelLayer.append(label);
  }
  container.replaceChildren(renderer.domElement, labelLayer);

  const state = {
    container,
    renderer,
    scene,
    camera,
    target: new THREE.Vector3(),
    resizeObserver: null,
    visualModel,
    physicalState,
    data,
    options: { ...options },
    nodeMeshes,
    rootHalos,
    debugHalos,
    arcLines,
    arrows,
    labels,
    labelLayer,
    controls: null,
    controlsChangeListener: null,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    pointerListeners: null,
    pointerDown: null,
    debugState: options.debugState ?? null,
    selectedLinkId: options.selectedLinkId ?? null,
    hoveredLinkId: null,
    presentation: null,
    lodPlan: null,
    readabilityAudit,
    performanceBudget,
  };
  rendererStates.set(container, state);
  configureControls(state);
  configurePicking(state);
  resize3dRenderer(container);
  fit3dRenderer(container);
  applyThreePresentationState(state);

  if (typeof ResizeObserver === "function") {
    state.resizeObserver = new ResizeObserver(() => resize3dRenderer(container));
    state.resizeObserver.observe(container);
  }
  return state;
}

export function update3dRenderer(container, visualModel, physicalState, options = {}) {
  return create3dRenderer(container, visualModel, physicalState, options);
}

export function destroy3dRenderer(container) {
  const state = rendererStates.get(container);
  if (!state) return false;
  state.resizeObserver?.disconnect();
  if (state.controls && state.controlsChangeListener) {
    state.controls.removeEventListener("change", state.controlsChangeListener);
  }
  state.controls?.dispose();

  const canvas = state.renderer.domElement;
  if (state.pointerListeners) {
    canvas.removeEventListener("pointerdown", state.pointerListeners.onPointerDown);
    canvas.removeEventListener("pointermove", state.pointerListeners.onPointerMove);
    canvas.removeEventListener("pointerleave", state.pointerListeners.onPointerLeave);
    canvas.removeEventListener("pointerup", state.pointerListeners.onPointerUp);
  }

  state.scene.traverse(disposeObject);
  state.renderer.dispose();
  state.labelLayer.remove();
  if (canvas.parentNode === container) canvas.remove();
  rendererStates.delete(container);
  return true;
}

export function has3dRenderer(container) {
  return rendererStates.has(container);
}
