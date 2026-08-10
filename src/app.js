import {
  detectFormat,
  downloadText,
  INPUT_FORMATS,
  parseArtifact,
  readUtf8File,
  serializeArtifact,
} from "./formats.js";
import { availableDeserializers, deserializerById } from "./deserializers.js";
import { renderAset } from "./visualizer.js";

const state = { cases: [], result: null, comparison: null };
const ids = [
  "inputFormat", "sample", "source", "algorithm", "compareAlgorithm", "createStorage",
  "run", "load", "file", "outputFormat", "save", "status", "summary", "symbols",
  "abits", "linkSequence", "rootChains", "storedAnums", "trace", "comparison",
  "asetJson", "graph",
];
const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

boot().catch(showError);

async function boot() {
  state.cases = await fetch("./examples/cases.json").then((r) => r.json());
  ui.inputFormat.replaceChildren(
    option("anum4", ".anum4 — четверичное"),
    option("anums", ".anums — строковое"),
    option("anum-json", ".anum.json — контейнер"),
    option("aset", ".aset.json — асеть"),
  );
  ui.outputFormat.replaceChildren(
    option("aset", ".aset.json — асеть"),
    option("anum4", ".anum4 — восстановить источник"),
    option("anums", ".anums — восстановить источник"),
    option("anum-json", ".anum.json — контейнер"),
  );
  ui.sample.replaceChildren(...state.cases.map((c, i) => option(String(i), `${c.id} — ${c.title}`)));
  ui.sample.addEventListener("change", selectSample);
  ui.inputFormat.addEventListener("change", refreshAlgorithms);
  ui.run.addEventListener("click", run);
  ui.load.addEventListener("click", () => ui.file.click());
  ui.file.addEventListener("change", loadFile);
  ui.save.addEventListener("click", saveOutput);
  selectSample();
  run();
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
    render();
    showStatus("Готово", "ok");
  } catch (error) { showError(error); }
}

function render() {
  const { aset, trace, result, carrier } = state.result;
  const source = aset.provenance?.source;
  ui.summary.replaceChildren(
    metric("Формат", `${aset.format}/${aset.version}`),
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
  renderAset(ui.graph, aset);
}

function renderTrace(trace) {
  ui.trace.replaceChildren();
  if (!trace?.length) {
    ui.trace.append(tableRow(["—", "—", "—", "—", "Для импортированной асети трассы нет"]));
    return;
  }
  for (const item of trace) {
    ui.trace.append(tableRow([
      item.step,
      item.token || "ε",
      item.operation,
      item.depth,
      `${item.current} · ${item.note}`,
    ]));
  }
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
    "Локальные id независимых асетей не являются общей exact-идентичностью.",
    "Сравнивайте топологию, трассу и экспорт, а не совпадение строковых id.",
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
  if (!state.result) return;
  try {
    const format = ui.outputFormat.value;
    const text = serializeArtifact(state.result.aset, format);
    const key = format === "anum-json" ? "anumJson" : format;
    const extension = INPUT_FORMATS[key]?.extension ?? ".txt";
    const mime = format.includes("json") || format === "aset" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8";
    downloadText(`experiment${extension}`, text, mime);
  } catch (error) { showError(error); }
}

function option(value, text) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = text;
  return node;
}

function metric(label, value) {
  const node = document.createElement("div");
  node.className = "metric";
  const name = document.createElement("span");
  const data = document.createElement("strong");
  name.textContent = label;
  data.textContent = String(value);
  node.append(name, data);
  return node;
}

function tableRow(values) {
  const row = document.createElement("tr");
  for (const value of values) {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    row.append(cell);
  }
  return row;
}

function pretty(value) { return JSON.stringify(value ?? [], null, 2); }
function clearStatus() { ui.status.className = "status"; ui.status.textContent = ""; }
function showStatus(text, kind) { ui.status.className = `status ${kind}`; ui.status.textContent = text; }
function showError(error) {
  console.error(error);
  const detail = error?.detail ? ` ${JSON.stringify(error.detail)}` : "";
  showStatus(`${error?.code ?? "error"}: ${error?.message ?? error}${detail}`, "error");
}
