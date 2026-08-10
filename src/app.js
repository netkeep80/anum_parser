import { detectFormat, downloadText, parseArtifact, readUtf8File } from "./formats.js";
import { availableDeserializers, deserializerById } from "./deserializers.js";
import { availableSerializers, serializerById } from "./serializers.js";
import {
  GRAPH_LAYOUTS,
  changeGraphLayout,
  fitGraph,
  renderAset,
  setGraphDebugState,
  zoomGraph,
} from "./visualizer.js";

const state = { cases: [], result: null, comparison: null, debugStep: 0 };
const ids = [
  "inputFormat", "sample", "source", "algorithm", "compareAlgorithm", "createStorage",
  "run", "load", "file", "serializer", "save", "status", "summary", "symbols",
  "abits", "linkSequence", "rootChains", "storedAnums", "trace", "comparison",
  "asetJson", "graph", "graphLayout", "graphFit", "graphZoomIn", "graphZoomOut", "appVersion",
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
    option("aset", ".aset.json — асеть"),
  );
  ui.graphLayout.replaceChildren(...GRAPH_LAYOUTS.map((layout) => option(layout.id, layout.title)));
  ui.graphLayout.value = "cose";
  ui.sample.replaceChildren(...state.cases.map((c, i) => option(String(i), `${c.id} — ${c.title}`)));
  ui.sample.addEventListener("change", selectSample);
  ui.inputFormat.addEventListener("change", refreshAlgorithms);
  ui.run.addEventListener("click", run);
  ui.load.addEventListener("click", () => ui.file.click());
  ui.file.addEventListener("change", loadFile);
  ui.save.addEventListener("click", saveOutput);
  ui.graphLayout.addEventListener("change", () => changeGraphLayout(ui.graph, ui.graphLayout.value));
  ui.graphFit.addEventListener("click", () => fitGraph(ui.graph));
  ui.graphZoomIn.addEventListener("click", () => zoomGraph(ui.graph, 1.28));
  ui.graphZoomOut.addEventListener("click", () => zoomGraph(ui.graph, 1 / 1.28));
  ui.debugFirst.addEventListener("click", () => setDebugStep(0));
  ui.debugPrev.addEventListener("click", () => setDebugStep(state.debugStep - 1));
  ui.debugNext.addEventListener("click", () => setDebugStep(state.debugStep + 1));
  ui.debugLast.addEventListener("click", () => setDebugStep(lastDebugStep()));
  ui.debugRange.addEventListener("input", () => setDebugStep(Number(ui.debugRange.value)));
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
  let kind = ui.inputFormat.value === "anums" ? "string" : "quaternary";
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
    showStatus("Готово", "ok");
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
  renderAset(ui.graph, aset, { layout: ui.graphLayout.value });
  renderDebugger();
  refreshSerializers();
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
    setGraphDebugState(ui.graph, null);
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
  setGraphDebugState(ui.graph, item);
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
