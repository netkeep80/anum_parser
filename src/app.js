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

const state = {
  cases: [],
  artifact: null,
  result: null,
  comparison: null,
};

const ui = Object.fromEntries(
  [
    "inputFormat",
    "sample",
    "source",
    "algorithm",
    "compareAlgorithm",
    "createStorage",
    "run",
    "load",
    "file",
    "outputFormat",
    "save",
    "status",
    "summary",
    "symbols",
    "abits",
    "linkSequence",
    "rootChains",
    "storedAnums",
    "trace",
    "comparison",
    "asetJson",
    "graph",
  ].map((id) => [id, document.getElementById(id)]),
);

boot().catch(showError);

async function boot() {
  state.cases = await fetch("./examples/cases.json").then((response) => response.json());
  fillFormats();
  fillSamples();
  ui.inputFormat.addEventListener("change", () => {
    refreshAlgorithms();
    clearStatus();
  });
  ui.sample.addEventListener("change", selectSample);
  ui.run.addEventListener("click", run);
  ui.load.addEventListener("click", () => ui.file.click());
  ui.file.addEventListener("change", loadFile);
  ui.save.addEventListener("click", saveOutput);
  selectSample();
  run();
}

function fillFormats() {
  const items = [INPUT_FORMATS.anum4, INPUT_FORMATS.anums, INPUT_FORMATS.anumJson, INPUT_FORMATS.aset];
  ui.inputFormat.replaceChildren(
    ...items.map((item) => option(item.id, `${item.title} (${item.extension})`)),
  );
  ui.outputFormat.replaceChildren(
    option("aset", ".aset.json — асеть"),
    option("anum4", ".anum4 — source replay"),
    option("anums", ".anums — source replay"),
    option("anum-json", ".anum.json — envelope"),
  );
}

function fillSamples() {
  ui.sample.replaceChildren(
    ...state.cases.map((item, index) => option(String(index), `${item.id} — ${item.title}`)),
  );
}

function selectSample() {
  const item = state.cases[Number(ui.sample.value || 0)];
  if (!item) return;
  ui.inputFormat.value = item.format;
  ui.source.value = item.source;
  refreshAlgorithms(item.algorithm);
}

function refreshAlgorithms(preferred = null) {
  let kind = ui.inputFormat.value === "anums" ? "string" : "quaternary";
  if (ui.inputFormat.value === "aset") {
    ui.algorithm.replaceChildren(option("none", "Асеть уже десериализована"));
    ui.compareAlgorithm.replaceChildren(option("none", "—"));
    return;
  }
  if (ui.inputFormat.value === "anum-json") {
    try {
      kind = JSON.parse(ui.source.value || "{}").kind ?? kind;
    } catch {
      // Точный diagnostic появится при Run.
    }
  }
  const variants = availableDeserializers(kind);
  ui.algorithm.replaceChildren(...variants.map((item) => option(item.id, badge(item))));
  ui.compareAlgorithm.replaceChildren(
    option("none", "— без сравнения —"),
    ...variants.map((item) => option(item.id, badge(item))),
  );
  if (preferred && variants.some((item) => item.id === preferred)) ui.algorithm.value = preferred;
}

function run() {
  clearStatus();
  try {
    const artifact = parseArtifact(ui.source.value, ui.inputFormat.value);
    state.artifact = artifact;
    if (ui.inputFormat.value === "aset") {
      state.result = { aset: artifact, trace: [], result: artifact.provenance?.representations?.denotation ?? artifact.root };
      state.comparison = null;
    } else {
      const algorithm = deserializerById(ui.algorithm.value);
      state.result = algorithm.deserialize(artifact, { createStorageLink: ui.createStorage.checked });
      state.comparison = null;
      if (ui.compareAlgorithm.value !== "none" && ui.compareAlgorithm.value !== ui.algorithm.value) {
        state.comparison = deserializerById(ui.compareAlgorithm.value).deserialize(artifact, {
          createStorageLink: ui.createStorage.checked,
        });
      }
    }
    render();
    showStatus("Готово", "ok");
  } catch (error) {
    showError(error);
  }
}

function render() {
  const { aset, trace, result, carrier } = state.result;
  const source = aset.provenance?.source;
  ui.summary.innerHTML = [
    metric("Формат", `${aset.format}/${aset.version}`),
    metric("Алгоритм", aset.provenance?.deserializer ?? "—"),
    metric("Связей", String(aset.links.length)),
    metric("Акорень", aset.root),
    metric("Carrier", carrier ?? aset.provenance?.representations?.carrier ?? "—"),
    metric("Денотат", result ?? aset.provenance?.representations?.denotation ?? "—"),
    metric("Source", source ? `${source.kind}: ${JSON.stringify(source.raw)}` : "—"),
  ].join("");

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
    ui.trace.append(row(["—", "—", "—", "—", "Нет трассы для импортированной асети"]));
    return;
  }
  for (const item of trace) {
    ui.trace.append(
      row([
        String(item.step),
        item.token || "ε",
        item.operation,
        String(item.depth),
        `${item.current} · ${item.note}`,
      ]),
    );
  }
}

function renderComparison() {
  if (!state.comparison) {
    ui.comparison.textContent = "Выберите второй алгоритм, чтобы сравнить один физический source.";
    return;
  }
  const a = state.result;
  const b = state.comparison;
  ui.comparison.textContent = [
    `A: ${a.aset.provenance.deserializer}`,
    `   result = ${a.result}`,
    `   links  = ${a.aset.links.length}`,
    `B: ${b.aset.provenance.deserializer}`,
    `   result = ${b.result}`,
    `   links  = ${b.aset.links.length}`,
    `Exact result совпал: ${a.result === b.result ? "да" : "нет"}`,
    "Важно: одинаковые локальные id разных запусков не означают общую exact occurrence между двумя независимыми асетями.",
  ].join("\n");
}

async function loadFile() {
  const file = ui.file.files?.[0];
  if (!file) return;
  try {
    const detected = detectFormat(file.name);
    if (detected) ui.inputFormat.value = detected;
    ui.source.value = await readUtf8File(file);
    refreshAlgorithms();
    run();
  } catch (error) {
    showError(error);
  } finally {
    ui.file.value = "";
  }
}

function saveOutput() {
  if (!state.result) return;
  try {
    const format = ui.outputFormat.value;
    const text = serializeArtifact(state.result.aset, format);
    const extension = INPUT_FORMATS[format === "anum-json" ? "anumJson" : format]?.extension ?? ".txt";
    downloadText(`experiment${extension}`, text, format.includes("json") || format === "aset" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8");
  } catch (error) {
    showError(error);
  }
}

function option(value, text) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = text;
  return node;
}

function badge(item) {
  return `${item.title} [${item.status}]`;
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function row(values) {
  const tr = document.createElement("tr");
  for (const value of values) {
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(td);
  }
  return tr;
}

function pretty(value) {
  return JSON.stringify(value ?? [], null, 2);
}

function clearStatus() {
  ui.status.className = "status";
  ui.status.textContent = "";
}

function showStatus(message, kind) {
  ui.status.className = `status ${kind}`;
  ui.status.textContent = message;
}

function showError(error) {
  console.error(error);
  const detail = error?.detail ? ` ${JSON.stringify(error.detail)}` : "";
  showStatus(`${error?.code ?? "error"}: ${error?.message ?? error}${detail}`, "error");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
