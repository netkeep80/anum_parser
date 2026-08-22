import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildThreePresentationState,
  resolvePickedLinkId3d,
} from "../src/three-renderer.js";
import { buildVisualModel } from "../src/visual-model.js";

function fixture() {
  return {
    root: "X",
    links: [
      { id: "X", start: "A", end: "B" },
      { id: "A", start: "A", end: "A" },
      { id: "B", start: "B", end: "B" },
    ],
    labels: {
      X: "root",
      A: "left",
      B: "right",
    },
  };
}

function byLink(presentation, linkId) {
  const found = presentation.nodes.find((node) => node.linkId === linkId);
  assert.ok(found, `presentation node ${linkId} must exist`);
  return found;
}

test("3D presentation нормализует тот же debugger state и не меняет semantic topology", () => {
  const visual = buildVisualModel(fixture());
  const before = structuredClone(visual);
  const presentation = buildThreePresentationState(visual, {
    visibleLinkIds: ["X", "A", "unknown"],
    producedLinks: ["A", "unknown"],
    reusedLinks: ["X"],
    current: "X",
  }, "A", null);

  assert.deepEqual(visual, before);
  assert.deepEqual(presentation.debugState, {
    visibleLinkIds: ["X", "A"],
    producedLinks: ["A"],
    reusedLinks: ["X"],
    current: "X",
  });

  const root = byLink(presentation, "X");
  assert.equal(root.visible, true);
  assert.equal(root.current, true);
  assert.equal(root.halo, "current");
  assert.equal(root.scale, 1.35);
  assert.equal(root.labelVisible, true);

  const selected = byLink(presentation, "A");
  assert.equal(selected.visible, true);
  assert.equal(selected.selected, true);
  assert.equal(selected.produced, true);
  assert.equal(selected.halo, "selected");
  assert.equal(selected.scale, 1.25);
  assert.equal(selected.labelVisible, true);

  const hidden = byLink(presentation, "B");
  assert.equal(hidden.visible, false);
  assert.equal(hidden.labelVisible, false);
});

test("debug visibility скрывает только arcs, чьи semantic endpoints не видимы", () => {
  const visual = buildVisualModel(fixture());
  const presentation = buildThreePresentationState(visual, {
    visibleLinkIds: ["X", "A"],
    producedLinks: [],
    reusedLinks: [],
    current: null,
  });
  const arcs = new Map(presentation.arcs.map((arc) => [arc.arcId, arc.visible]));

  assert.equal(arcs.get("pole-start:X"), true);
  assert.equal(arcs.get("pole-end:X"), false);
  assert.equal(arcs.get("pole-start:A"), true);
  assert.equal(arcs.get("pole-end:A"), true);
  assert.equal(arcs.get("pole-start:B"), false);
  assert.equal(arcs.get("pole-end:B"), false);
});

test("без debugger state все известные links видимы, root label остаётся доступным", () => {
  const visual = buildVisualModel(fixture());
  const presentation = buildThreePresentationState(visual, null);

  assert.ok(presentation.nodes.every((node) => node.visible));
  assert.equal(byLink(presentation, "X").labelVisible, true);
  assert.equal(byLink(presentation, "A").labelVisible, false);
});

test("hover/selection/current используют presentation channels, а не semantic RGB", () => {
  const visual = buildVisualModel(fixture());
  const selected = buildThreePresentationState(visual, null, "A", null);
  const hovered = buildThreePresentationState(visual, null, null, "B");

  assert.equal(byLink(selected, "A").halo, "selected");
  assert.equal(byLink(selected, "A").labelVisible, true);
  assert.equal(byLink(hovered, "B").halo, "hovered");
  assert.equal(byLink(hovered, "B").labelVisible, true);
  assert.deepEqual(visual.semanticStyle.colors, {
    start: "#ff657a",
    center: "#67e8b3",
    end: "#73a7ff",
  });
});

test("Raycaster picking возвращает exact linkId только от GREEN link-center mesh", () => {
  const intersections = [
    { object: { userData: { kind: "semantic-spring", linkId: "wrong" } } },
    { object: { userData: { kind: "root-halo", linkId: "also-wrong" } } },
    { object: { userData: { kind: "link-center", linkId: "X" } } },
  ];
  assert.equal(resolvePickedLinkId3d(intersections), "X");
  assert.equal(resolvePickedLinkId3d([]), null);
  assert.equal(resolvePickedLinkId3d(null), null);
});

test("renderer использует exact-local OrbitControls, pointer/touch path и симметричный disposal", async () => {
  const source = await readFile(new URL("../src/three-renderer.js", import.meta.url), "utf8");

  assert.match(source, /three\/addons\/controls\/OrbitControls\.js/);
  assert.match(source, /new OrbitControls\(/);
  assert.match(source, /new THREE\.Raycaster\(\)/);
  assert.match(source, /touchAction\s*=\s*"none"/);
  assert.match(source, /addEventListener\("pointerdown"/);
  assert.match(source, /addEventListener\("pointermove"/);
  assert.match(source, /addEventListener\("pointerup"/);
  assert.match(source, /removeEventListener\("pointerdown"/);
  assert.match(source, /removeEventListener\("pointermove"/);
  assert.match(source, /removeEventListener\("pointerup"/);
  assert.match(source, /state\.controls\?\.dispose\(\)/);
  assert.match(source, /three-label-layer/);
  assert.match(source, /userData\s*=\s*\{ kind: "link-center", linkId:/);
  assert.doesNotMatch(source, /https?:\/\//i);
});

test("debugger presentation не перекрашивает semantic node/spring materials", async () => {
  const source = await readFile(new URL("../src/three-renderer.js", import.meta.url), "utf8");
  const start = source.indexOf("function applyThreePresentationState");
  const end = source.indexOf("function configureControls", start);
  assert.ok(start >= 0 && end > start);
  const presentationSection = source.slice(start, end);

  assert.doesNotMatch(presentationSection, /mesh\.material\.color/);
  assert.doesNotMatch(presentationSection, /line\.material\.color/);
  assert.match(presentationSection, /debugHalo\.material\.color/);
});

test("app сохраняет settled physics и debugger step не перезапускает solver", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(source, /state\.physicalState \?\?= solvePhysicalLayout3d\(state\.visualModel\)/);
  assert.match(source, /set3dDebugState\(ui\.graph, item\)/);
  assert.match(source, /selectedLinkId: state\.selectedLinkId/);
  assert.match(source, /onSelectLink: \(linkId\) =>/);

  const start = source.indexOf("function renderDebugger");
  const end = source.indexOf("function renderDebugSource", start);
  assert.ok(start >= 0 && end > start);
  const debuggerSection = source.slice(start, end);
  assert.doesNotMatch(debuggerSection, /solvePhysicalLayout3d/);
});
