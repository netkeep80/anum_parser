import * as THREE from "three";

import {
  addVec3,
  normVec3,
  normalizeVec3,
  scaleVec3,
  semanticLinkGeometry3d,
  springCurveAroundCenterline3d,
  subtractVec3,
} from "./geometry3d.js";

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

function threeVector(point) {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function addNodeMesh(scene, node, options) {
  const geometry = new THREE.SphereGeometry(node.radius, 16, 12);
  const material = new THREE.MeshBasicMaterial({ color: node.color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(threeVector(node.position));
  mesh.userData = { kind: "link-center", linkId: node.linkId, root: node.root };
  scene.add(mesh);

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
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.position.copy(mesh.position);
    halo.userData = { kind: "root-halo", linkId: node.linkId };
    scene.add(halo);
  }
}

function addArcLine(scene, arc) {
  if (arc.points.length < 2) return;
  const geometry = new THREE.BufferGeometry().setFromPoints(arc.points.map(threeVector));
  const from = new THREE.Color(arc.colorFrom);
  const to = new THREE.Color(arc.colorTo);
  const colors = [];
  for (let index = 0; index < arc.points.length; index += 1) {
    const t = arc.points.length === 1 ? 0 : index / (arc.points.length - 1);
    const color = from.clone().lerp(to, t);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.LineBasicMaterial({ vertexColors: true });
  const line = new THREE.Line(geometry, material);
  line.userData = {
    kind: "semantic-spring",
    arcId: arc.arcId,
    linkId: arc.linkId,
    role: arc.role,
    self: arc.self,
    forceSpring: arc.forceSpring,
  };
  scene.add(line);
}

function addEndArrow(scene, arc, options) {
  if (arc.role !== "end" || arc.arrow !== "target" || arc.points.length === 0) return;
  const endpoint = arc.points.at(-1);
  const direction = normalizeVec3(arc.endTangent);
  if (!direction || normVec3(direction) === 0) return;

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
}

function disposeObject(object) {
  object.geometry?.dispose?.();
  if (Array.isArray(object.material)) {
    for (const material of object.material) material.dispose?.();
  } else {
    object.material?.dispose?.();
  }
}

function renderState(state) {
  state.renderer.render(state.scene, state.camera);
}

function viewportSize(container) {
  return {
    width: Math.max(1, container.clientWidth || container.getBoundingClientRect?.().width || 1),
    height: Math.max(1, container.clientHeight || container.getBoundingClientRect?.().height || 1),
  };
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
    state.camera.position.set(0, 0, 4);
    state.camera.lookAt(0, 0, 0);
    renderState(state);
    return true;
  }

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
  state.camera.lookAt(state.target);
  renderState(state);
  return true;
}

export function zoom3dRenderer(container, factor) {
  const state = rendererStates.get(container);
  if (!state || !Number.isFinite(factor) || factor <= 0) return false;
  const offset = state.camera.position.clone().sub(state.target);
  const nextDistance = Math.max(0.25, Math.min(500, offset.length() / factor));
  offset.setLength(nextDistance);
  state.camera.position.copy(state.target).add(offset);
  state.camera.lookAt(state.target);
  renderState(state);
  return true;
}

export function create3dRenderer(container, visualModel, physicalState, options = {}) {
  destroy3dRenderer(container);
  const data = buildThreeSceneData(visualModel, physicalState, options);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(options.background ?? DEFAULT_BACKGROUND);

  for (const node of data.nodes) addNodeMesh(scene, node, options);
  for (const arc of data.arcs) {
    addArcLine(scene, arc);
    addEndArrow(scene, arc, options);
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
  container.replaceChildren(renderer.domElement);

  const state = {
    renderer,
    scene,
    camera,
    target: new THREE.Vector3(),
    resizeObserver: null,
    visualModel,
    physicalState,
    data,
    options: { ...options },
  };
  rendererStates.set(container, state);
  resize3dRenderer(container);
  fit3dRenderer(container);

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
  state.scene.traverse(disposeObject);
  state.renderer.dispose();
  if (state.renderer.domElement.parentNode === container) {
    state.renderer.domElement.remove();
  }
  rendererStates.delete(container);
  return true;
}

export function has3dRenderer(container) {
  return rendererStates.has(container);
}
