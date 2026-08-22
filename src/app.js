import { detectFormat, downloadText, parseArtifact, readUtf8File } from "./formats.js";
import { availableDeserializers, deserializerById } from "./deserializers.js";
import { availableSerializers, serializerById } from "./serializers.js";
import { DEFAULT_PHYSICS3D_OPTIONS } from "./physics3d.js";
import { solveReadableLayout3d } from "./readable-layout3d.js";
import {
  create3dRenderer,
  destroy3dRenderer,
  fit3dRenderer,
  reset3dLivePhysics,
  resize3dRenderer,
  set3dDebugState,
  set3dLivePhysicsOptions,
  set3dLivePhysicsPaused,
  set3dSelectedLink,
  zoom3dRenderer,
} from "./three-renderer.js";
import {
  createBlueprintRenderer,
  destroyBlueprintRenderer,
  fitBlueprintRenderer,
  getBlueprintRendererSnapshot,
  setBlueprintDebugState,
  setBlueprintSelectedLink,
  zoomBlueprintRenderer,
} from "./blueprint-renderer.js";
import { buildVisualModel } from "./visual-model.js";
import {
  GRAPH_LAYOUTS,
  ROOTED_LAYOUT_ID,
  changeGraphLayout,
  destroyGraph,
  fitGraph,
  renderAset,
  setGraphDebugState,
  zoomGraph,
} from "./visualizer.js";

const state = {
  cases: [],
  result: null,
  comparison: null,
  debugStep: 0,
  graphView: "2d",
  visualModel: null,
  physicalState: null,
  blueprintPositions: null,
  selectedLinkId: null,
  graphWarning: null,
  physicsOptions: {
    charge: DEFAULT_PHYSICS3D_OPTIONS.charge,
    springStiffness: DEFAULT_PHYSICS3D_OPTIONS.springStiffness,
    damping: DEFAULT_PHYSICS3D_OPTIONS.damping,
  },
  physicsPaused: false,
  fullscreenFallback: false,
};
const ids = [
  "inputFormat", "sample", "source", "algorithm", "compareAlgorithm", "createStorage",
  "run", "load", "file", "serializer", "save", "status", "summary", "symbols",
  "abits", "linkSequence", "rootChains", "storedAnums", "trace", "comparison",
  "asetJson", "graphPanel", "graph", "graphView", "graphLayout", "graphFit", "graphFullscreen",
  "graphZoomIn", "graphZoomOut", "appVersion",
  "graphPhysicsControls", "graphCharge", "graphChargeValue", "graphSpringStiffness",
  "graphSpringStiffnessValue", "graphDamping", "graphDampingValue", "graphPhysicsPause",
  "graphPhysicsReset",
  "debugFirst", "debugPrev", "debugRange", "debugNext", "debugLast", "debugStep",
  "debugSource", "debugCurrent", "debugStack", "debugEffects",
];
const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

boot().catch(showError);

async function boot() {
  const [cases, version] = await Promise.all([
    fetch("./examples/cases.json").then((r) => r.json()),
    loadVersion(),
  ]);
  state.cases = cases;
  renderVersion(version);
  ui.inputFormat.replaceChildren(
    option("anum4", ".anum4 — четверичное"),
    option("anums", ".anums — строковое"),
    option("anum-json", ".anum.json — контейнер"),
    option("aset", ".aset.json — открыть асеть"),
    option("aset-carrier", ".aset.json — прочитать carrier через ANUM v0.4"),
  );
  ui.graphView.value = state.graphView;
  ui.graphLayout.replaceChildren(...GRAPH_LAYOUTS.map((layout) => option(layout.id, layout.title)));
  ui.graphLayout.value = ROOTED_LAYOUT_ID;
  ui.sample.replaceChildren(...state.cases.map((c, i) => option(String(i), `${c.id} — ${c.title}`)));
  ui.sample.addEventListener("change", selectSample);
  ui.inputFormat.addEventListener("change", refreshAlgorithms);
  ui.run.addEventListener("click", run);
  ui.load.addEventListener("click", () => ui.file.click());
  ui.file.addEventListener("change", loadFile);
  ui.save.addEventListener("click", saveOutput);
  ui.graphView.addEventListener("change", () => { void changeGraphView().catch(showError); });
  ui.graphLayout.addEventListener("change", () => {
    if (state.graphView === "2d") changeGraphLayout(ui.graph, ui.graphLayout.value);
  });
  ui.graphFit.addEventListener("click", fitCurrentGraph);
  ui.graphFullscreen.addEventListener("click", () => { void toggleGraphFullscreen().catch(showError); });
  ui.graphZoomIn.addEventListener("click", () => zoomCurrentGraph(1.28));
  ui.graphZoomOut.addEventListener("click", () => zoomCurrentGraph(1 / 1.28));
  ui.graphCharge.addEventListener("input", () => changePhysicsOption("charge", ui.graphCharge));
  ui.graphSpringStiffness.addEventListener("input", () => changePhysicsOption("springStiffness", ui.graphSpringStiffness));
  ui.graphDamping.addEventListener("input", () => changePhysicsOption("damping", ui.graphDamping));
  ui.graphPhysicsPause.addEventListener("click", togglePhysicsPause);
  ui.graphPhysicsReset.addEventListener("click", resetCurrentPhysics);
  ui.debugFirst.addEventListener("click", () => setDebugStep(0));
  ui.debugPrev.addEventListener("click", () => setDebugStep(state.debugStep - 1));
  ui.debugNext.addEventListener("click", () => setDebugStep(state.debugStep + 1));
  ui.debugLast.addEventListener("click", () => setDebugStep(lastDebugStep()));
  ui.debugRange.addEventListener("input", () => setDebugStep(Number(ui.debugRange.value)));
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("keydown", handleFullscreenEscape);
  renderPhysicsControls();
  selectSample();
  run();
}

async function loadVersion() {
  try {
    const response = await fetch("./package.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const metadata = await response.json();
    return typeof metadata.version === "string" ? metadata.version : null;
  } catch (error) {
    console.warn("Не удалось прочитать версию приложения из package.json", error);
    return null;
  }
}

function renderVersion(version) {
  ui.appVersion.textContent = version ? `v${version}` : "версия ?";
  if (version) document.title = `anum_parser v${version} — лаборатория ачисел`;
}

function selectSample() {
  const item = state.cases[Number(ui.sample.value || 0)];
  if (!item) return;
  ui.inputFormat.value = item.format;
  ui.source.value = item.source;
  refreshAlgorithms(item.algorithm);
}

function refreshAlgorithms(preferred = null) {
  if (ui.inputFormat.value === "aset") {
    ui.algorithm.replaceChildren(option("none", "Асеть уже загружена"));
    ui.compareAlgorithm.replaceChildren(option("none", "—"));
    return;
  }
  let kind = ui.inputFormat.value === "anums"
    ? "string"
    : ui.inputFormat.value === "aset-carrier"
      ? "aset-carrier"
      : "quaternary";
  if (ui.inputFormat.value === "anum-json") {
    try { kind = JSON.parse(ui.source.value || "{}").kind ?? kind; } catch { /* diagnostic при запуске */ }
  }
  const variants = availableDeserializers(kind);
  ui.algorithm.replaceChildren(...variants.map((v) => option(v.id, `${v.title} [${v.status}]`)));
  ui.compareAlgorithm.replaceChildren(option("none", "— без сравнения —"), ...variants.map((v) => option(v.id, `${v.title} [${v.status}]`)));
  if (preferred && variants.some((v) => v.id === preferred)) ui.algorithm.value = preferred;
}

function refreshSerializers() {
  const previous = ui.serializer.value;
  const variants = state.result ? availableSerializers(state.result.aset) : [];
  ui.serializer.replaceChildren(...variants.map((v) => option(v.id, `${v.title} [${v.status}]`)));
  if (variants.some((v) => v.id === previous)) ui.serializer.value = previous;
  ui.save.disabled = variants.length === 0;
}

function run() {
  clearStatus();
  try {
    const artifact = parseArtifact(ui.source.value, ui.inputFormat.value);
    if (ui.inputFormat.value === "aset") {
      state.result = {
        aset: artifact,
        trace: [],
        result: artifact.provenance?.representations?.denotation ?? artifact.root,
        carrier: artifact.provenance?.representations?.carrier,
      };
      state.comparison = null;
    } else {
      const options = { createStorageLink: ui.createStorage.checked };
      state.result = deserializerById(ui.algorithm.value).deserialize(artifact, options);
      state.comparison =
        ui.compareAlgorithm.value !== "none" && ui.compareAlgorithm.value !== ui.algorithm.value
          ? deserializerById(ui.compareAlgorithm.value).deserialize(artifact, options)
          : null;
    }
    state.debugStep = lastDebugStep();
    render();
    if (state.graphWarning) showStatus(state.graphWarning, "error");
    else showStatus("Готово", "ok");
  } catch (error) { showError(error); }
}

function render() {
  const { aset, trace, result, carrier } = state.result;
  const source = aset.provenance?.source;
  ui.summary.replaceChildren(
    metric("Формат", `${aset.format}/${aset.version}`),
    metric("Тождество", aset.identity ?? "—"),
    metric("Алгоритм", aset.provenance?.deserializer ?? "—"),
    metric("Связей", aset.links.length),
    metric("Акорень", aset.root),
    metric("Носитель", carrier ?? aset.provenance?.representations?.carrier ?? "—"),
    metric("Денотат", result ?? aset.provenance?.representations?.denotation ?? "—"),
    metric("Источник", source ? `${source.kind}: ${JSON.stringify(source.raw)}` : "—"),
  );
  ui.symbols.textContent = pretty(aset.symbolSequences);
  ui.abits.textContent = pretty(aset.abitSequences);
  ui.linkSequence.textContent = pretty(aset.linkSequences);
  ui.rootChains.textContent = pretty(aset.rootChains);
  ui.storedAnums.textContent = pretty(aset.storedAnums);
  ui.asetJson.textContent = JSON.stringify(aset, null, 2);
  renderTrace(trace);
  renderComparison();
  state.visualModel = buildVisualModel(aset);
  state.physicalState = null;
  state.blueprintPositions = null;
  state.selectedLinkId = null;
  renderGraph();
  renderDebugger();
  refreshSerializers();
}

async function changeGraphView() {
  clearStatus();
  const requested = ui.graphView.value;
  const nextView = requested === "3d" || requested === "blueprint" ? requested : "2d";
  if (nextView !== "3d" && graphIsFullscreen()) await exitGraphFullscreen();
  state.graphView = nextView;
  renderGraph();
  renderDebugger();
  if (state.graphWarning) showStatus(state.graphWarning, "error");
}

function currentDebugState() {
  const trace = state.result?.trace ?? [];
  return trace.length > 0 ? trace[state.debugStep] ?? null : null;
}

function captureBlueprintPositions() {
  const snapshot = getBlueprintRendererSnapshot(ui.graph);
  if (snapshot?.positions) state.blueprintPositions = snapshot.positions;
}

function renderGraph() {
  const aset = state.result?.aset;
  if (!aset) return;
  state.visualModel ??= buildVisualModel(aset);
  state.graphWarning = null;

  if (state.graphView === "3d") {
    try {
      captureBlueprintPositions();
      destroyBlueprintRenderer(ui.graph);
      destroyGraph(ui.graph);
      state.physicalState ??= solveReadableLayout3d(state.visualModel);
      create3dRenderer(ui.graph, state.visualModel, state.physicalState, {
        physics: state.physicsOptions,
        debugState: currentDebugState(),
        selectedLinkId: state.selectedLinkId,
        onSelectLink: (linkId) => {
          state.selectedLinkId = linkId;
        },
      });
      set3dSelectedLink(ui.graph, state.selectedLinkId);
      set3dLivePhysicsPaused(ui.graph, state.physicsPaused);
    } catch (error) {
      console.warn("3D renderer unavailable; falling back to structural 2D", error);
      destroy3dRenderer(ui.graph);
      state.graphView = "2d";
      if (graphIsFullscreen()) void exitGraphFullscreen();
      state.graphWarning = `3D недоступен: ${error?.message ?? error}. Включён структурный 2D.`;
      renderAset(ui.graph, aset, {
        layout: ui.graphLayout.value,
        visualModel: state.visualModel,
      });
    }
  } else if (state.graphView === "blueprint") {
    destroy3dRenderer(ui.graph);
    destroyGraph(ui.graph);
    createBlueprintRenderer(ui.graph, state.visualModel, {
      positions: state.blueprintPositions,
      debugState: currentDebugState(),
      selectedLinkId: state.selectedLinkId,
      onSelectLink: (linkId) => {
        state.selectedLinkId = linkId;
      },
    });
    setBlueprintSelectedLink(ui.graph, state.selectedLinkId);
  } else {
    captureBlueprintPositions();
    destroyBlueprintRenderer(ui.graph);
    destroy3dRenderer(ui.graph);
    renderAset(ui.graph, aset, {
      layout: ui.graphLayout.value,
      visualModel: state.visualModel,
    });
  }
  updateGraphControls();
}

function updateGraphControls() {
  const is3d = state.graphView === "3d";
  const is2d = state.graphView === "2d";
  ui.graphView.value = state.graphView;
  ui.graphLayout.disabled = !is2d;
  ui.graphLayout.title = is2d
    ? "Алгоритм авторазвёртки структурного 2D"
    : "Раскладки Cytoscape относятся только к структурному 2D-представлению";
  ui.graphPhysicsControls.hidden = !is3d;
  ui.graph.dataset.viewMode = state.graphView;
  renderPhysicsControls();
  renderFullscreenControl();
}

function renderPhysicsControls() {
  ui.graphCharge.value = String(state.physicsOptions.charge);
  ui.graphChargeValue.textContent = Number(state.physicsOptions.charge).toFixed(2);
  ui.graphSpringStiffness.value = String(state.physicsOptions.springStiffness);
  ui.graphSpringStiffnessValue.textContent = Number(state.physicsOptions.springStiffness).toFixed(3);
  ui.graphDamping.value = String(state.physicsOptions.damping);
  ui.graphDampingValue.textContent = Number(state.physicsOptions.damping).toFixed(2);
  ui.graphPhysicsPause.textContent = state.physicsPaused ? "Продолжить" : "Пауза";
  const active = state.graphView === "3d";
  ui.graphCharge.disabled = !active;
  ui.graphSpringStiffness.disabled = !active;
  ui.graphDamping.disabled = !active;
  ui.graphPhysicsPause.disabled = !active;
  ui.graphPhysicsReset.disabled = !active;
}

function changePhysicsOption(key, input) {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  state.physicsOptions = { ...state.physicsOptions, [key]: value };
  if (state.graphView === "3d") set3dLivePhysicsOptions(ui.graph, { [key]: value });
  renderPhysicsControls();
}

function togglePhysicsPause() {
  if (state.graphView !== "3d") return;
  state.physicsPaused = !state.physicsPaused;
  set3dLivePhysicsPaused(ui.graph, state.physicsPaused);
  renderPhysicsControls();
}

function resetCurrentPhysics() {
  if (state.graphView !== "3d") return;
  reset3dLivePhysics(ui.graph);
  renderPhysicsControls();
}

function graphIsFullscreen() {
  return document.fullscreenElement === ui.graphPanel || state.fullscreenFallback;
}

function schedule3dResize() {
  if (state.graphView !== "3d") return;
  const resize = () => resize3dRenderer(ui.graph);
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(resize);
  } else {
    globalThis.setTimeout(resize, 0);
  }
}

function applyFullscreenFallback(active) {
  state.fullscreenFallback = Boolean(active);
  ui.graphPanel.classList.toggle("graph-fullscreen-fallback", state.fullscreenFallback);
  document.body.classList.toggle("graph-fullscreen-active", state.fullscreenFallback);
}

function renderFullscreenControl() {
  const active3d = state.graphView === "3d";
  const fullscreen = graphIsFullscreen();
  ui.graphFullscreen.hidden = !active3d;
  ui.graphFullscreen.disabled = !active3d;
  ui.graphFullscreen.textContent = fullscreen ? "Выйти из полноэкранного" : "На весь экран";
  ui.graphFullscreen.setAttribute("aria-pressed", String(fullscreen));
  ui.graphFullscreen.title = fullscreen
    ? "Вернуть 3D в страницу"
    : "Развернуть 3D на весь экран браузера";
}

async function enterGraphFullscreen() {
  if (state.graphView !== "3d" || graphIsFullscreen()) return false;
  const request = ui.graphPanel.requestFullscreen;
  if (typeof request === "function") {
    try {
      await request.call(ui.graphPanel);
      renderFullscreenControl();
      schedule3dResize();
      return true;
    } catch (error) {
      console.warn("Native fullscreen unavailable; using viewport fallback", error);
    }
  }
  applyFullscreenFallback(true);
  renderFullscreenControl();
  schedule3dResize();
  return true;
}

async function exitGraphFullscreen() {
  if (document.fullscreenElement === ui.graphPanel && typeof document.exitFullscreen === "function") {
    try {
      await document.exitFullscreen();
    } catch (error) {
      console.warn("Failed to exit native fullscreen", error);
    }
  }
  if (state.fullscreenFallback) applyFullscreenFallback(false);
  renderFullscreenControl();
  schedule3dResize();
  return true;
}

async function toggleGraphFullscreen() {
  if (state.graphView !== "3d") return;
  if (graphIsFullscreen()) await exitGraphFullscreen();
  else await enterGraphFullscreen();
}

function handleFullscreenChange() {
  if (document.fullscreenElement === ui.graphPanel && state.fullscreenFallback) {
    applyFullscreenFallback(false);
  }
  renderFullscreenControl();
  schedule3dResize();
}

function handleFullscreenEscape(event) {
  if (event.key !== "Escape" || !state.fullscreenFallback) return;
  event.preventDefault();
  void exitGraphFullscreen();
}

function fitCurrentGraph() {
  if (state.graphView === "3d") fit3dRenderer(ui.graph);
  else if (state.graphView === "blueprint") fitBlueprintRenderer(ui.graph);
  else fitGraph(ui.graph);
}

function zoomCurrentGraph(factor) {
  if (state.graphView === "3d") zoom3dRenderer(ui.graph, factor);
  else if (state.graphView === "blueprint") zoomBlueprintRenderer(ui.graph, factor);
  else zoomGraph(ui.graph, factor);
}

function renderTrace(trace) {
  ui.trace.replaceChildren();
  if (!trace?.length) {
    ui.trace.append(tableRow(["—", "—", "—", "—", "—", "Для импортированной асети трассы нет"]));
    return;
  }
  const sourceLength = Array.from(state.result.aset.provenance?.source?.raw ?? "").length;
  trace.forEach((item, index) => {
    const position = item.sourceIndex < 0 ? "—" : item.sourceIndex >= sourceLength ? "конец" : item.sourceIndex;
    const row = tableRow([
      item.step,
      position,
      item.token || "ε",
      item.operation,
      item.depth,
      `${item.current} · ${item.note}`,
    ]);
    row.dataset.step = String(index);
    row.addEventListener("click", () => setDebugStep(index));
    ui.trace.append(row);
  });
}

function renderDebugger() {
  const trace = state.result?.trace ?? [];
  const enabled = trace.length > 0;
  const max = Math.max(0, trace.length - 1);
  state.debugStep = Math.max(0, Math.min(max, state.debugStep));
  ui.debugRange.max = String(max);
  ui.debugRange.value = String(state.debugStep);
  ui.debugRange.disabled = !enabled;
  ui.debugFirst.disabled = !enabled || state.debugStep === 0;
  ui.debugPrev.disabled = !enabled || state.debugStep === 0;
  ui.debugNext.disabled = !enabled || state.debugStep === max;
  ui.debugLast.disabled = !enabled || state.debugStep === max;
  ui.debugStep.textContent = enabled ? `${state.debugStep + 1} / ${trace.length}` : "—";

  if (!enabled) {
    ui.debugSource.textContent = state.result?.aset?.provenance?.source?.raw ?? "—";
    ui.debugCurrent.textContent = "Для импортированной асети пошагового состояния нет.";
    ui.debugStack.replaceChildren(textNode("Стек недоступен для этого входа."));
    ui.debugEffects.textContent = "—";
    if (state.graphView === "3d") set3dDebugState(ui.graph, null);
    else if (state.graphView === "blueprint") setBlueprintDebugState(ui.graph, null);
    else setGraphDebugState(ui.graph, null);
    updateTraceSelection();
    return;
  }

  const item = trace[state.debugStep];
  renderDebugSource(state.result.aset.provenance?.source?.raw ?? "", item.sourceIndex);
  ui.debugCurrent.textContent = [
    `операция: ${item.operation}`,
    `позиция: ${item.sourceIndex < 0 ? "до начала" : item.sourceIndex}`,
    `символ: ${JSON.stringify(item.token || "ε")}`,
    `разрешено в: ${item.resolved ?? "—"}`,
    `глубина: ${item.depth}`,
    `top: ${item.top}`,
    `current: ${item.current}`,
    `значения: [${(item.values ?? []).join(", ")}]`,
    `комментарий: ${item.note}`,
  ].join("\n");
  renderDebugStack(item);
  ui.debugEffects.textContent = [
    `видимых связей: ${(item.visibleLinkIds ?? []).length}`,
    `добавлено: ${(item.producedLinks ?? []).join(", ") || "—"}`,
    `переиспользовано: ${(item.reusedLinks ?? []).join(", ") || "—"}`,
  ].join("\n");
  if (state.graphView === "3d") set3dDebugState(ui.graph, item);
  else if (state.graphView === "blueprint") setBlueprintDebugState(ui.graph, item);
  else setGraphDebugState(ui.graph, item);
  updateTraceSelection();
}

function renderDebugSource(raw, sourceIndex) {
  ui.debugSource.replaceChildren();
  const symbols = Array.from(raw);
  if (symbols.length === 0) {
    ui.debugSource.append(textNode("ε"));
    return;
  }
  symbols.forEach((symbol, index) => {
    const span = document.createElement("span");
    span.className = `debug-char${index === sourceIndex ? " active" : ""}`;
    span.textContent = symbol === "\n" ? "↵" : symbol === "\t" ? "⇥" : symbol;
    span.title = `позиция ${index}: ${JSON.stringify(symbol)}`;
    ui.debugSource.append(span);
  });
  if (sourceIndex >= symbols.length) {
    const caret = document.createElement("span");
    caret.className = "debug-caret";
    caret.title = "конец исходной записи";
    ui.debugSource.append(caret);
  }
}

function renderDebugStack(item) {
  ui.debugStack.replaceChildren();
  if (!item.stack?.length) {
    ui.debugStack.append(textNode("Этот алгоритм не использует стековую трассу."));
    return;
  }
  item.stack.forEach((frame) => {
    const card = document.createElement("div");
    card.className = `stack-frame${frame.level === item.top ? " top" : ""}`;
    const head = document.createElement("strong");
    head.textContent = `${frame.level === item.top ? "↑ " : ""}уровень ${frame.level}`;
    const details = document.createElement("div");
    details.textContent = `open: ${frame.openIndex ?? "корень"} · current: ${frame.current}`;
    const values = document.createElement("div");
    values.className = "stack-values";
    values.textContent = `values: [${frame.values.join(", ")}]`;
    card.append(head, details, values);
    ui.debugStack.append(card);
  });
}

function setDebugStep(index) {
  if (!state.result?.trace?.length) return;
  state.debugStep = Math.max(0, Math.min(lastDebugStep(), Number(index) || 0));
  renderDebugger();
}

function lastDebugStep() {
  return Math.max(0, (state.result?.trace?.length ?? 1) - 1);
}

function updateTraceSelection() {
  ui.trace.querySelectorAll("tr[data-step]").forEach((row) => {
    row.classList.toggle("active", Number(row.dataset.step) === state.debugStep);
  });
}

function renderComparison() {
  if (!state.comparison) {
    ui.comparison.textContent = "Выберите второй алгоритм для одного и того же физического источника.";
    return;
  }
  const a = state.result;
  const b = state.comparison;
  ui.comparison.textContent = [
    `A: ${a.aset.provenance.deserializer}`,
    `   result(local) = ${a.result}`,
    `   links = ${a.aset.links.length}`,
    `B: ${b.aset.provenance.deserializer}`,
    `   result(local) = ${b.result}`,
    `   links = ${b.aset.links.length}`,
    "",
    "Связь МТС определяется парой (начало, конец).",
    "Технические id двух независимо построенных файлов сравнивать напрямую нельзя: сравнивайте каноническую топологию пар, трассу и результат.",
  ].join("\n");
}

async function loadFile() {
  const file = ui.file.files?.[0];
  if (!file) return;
  try {
    const format = detectFormat(file.name);
    if (format) ui.inputFormat.value = format;
    ui.source.value = await readUtf8File(file);
    refreshAlgorithms();
    run();
  } catch (error) { showError(error); }
  finally { ui.file.value = ""; }
}

function saveOutput() {
  if (!state.result || !ui.serializer.value) return;
  try {
    const output = serializerById(ui.serializer.value).serialize(state.result.aset);
    downloadText(output.filename, output.text, output.mime);
  } catch (error) { showError(error); }
}

function option(value, text) { const n = document.createElement("option"); n.value = value; n.textContent = text; return n; }
function metric(label, value) { const n = document.createElement("div"); n.className = "metric"; const a = document.createElement("span"); const b = document.createElement("strong"); a.textContent = label; b.textContent = String(value); n.append(a, b); return n; }
function tableRow(values) { const r = document.createElement("tr"); for (const value of values) { const c = document.createElement("td"); c.textContent = String(value); r.append(c); } return r; }
function textNode(value) { const node = document.createElement("span"); node.textContent = value; return node; }
function pretty(value) { return JSON.stringify(value ?? [], null, 2); }
function clearStatus() { ui.status.className = "status"; ui.status.textContent = ""; }
function showStatus(text, kind) { ui.status.className = `status ${kind}`; ui.status.textContent = text; }
function showError(error) { console.error(error); const detail = error?.detail ? ` ${JSON.stringify(error.detail)}` : ""; showStatus(`${error?.code ?? "error"}: ${error?.message ?? error}${detail}`, "error"); }
