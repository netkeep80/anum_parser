import { validateAset } from "./model.js";

export const INPUT_FORMATS = {
  anum4: { id: "anum4", extension: ".anum4", title: "Четверичное ачисло" },
  anums: { id: "anums", extension: ".anums", title: "Строковое ачисло" },
  anumJson: { id: "anum-json", extension: ".anum.json", title: "Самодокументируемое ачисло" },
  aset: { id: "aset", extension: ".aset.json", title: "Асеть JSON" },
};

export const ABIT_PROFILE = "mts-abit-v1";
export const ABIT_SYMBOLS = new Set(["[", "]", "1", "0"]);

export function parseAnum4(text) {
  if (text.startsWith("\uFEFF")) throw formatError("bom-not-allowed", "BOM запрещён в .anum4");
  const symbols = Array.from(text);
  for (let i = 0; i < symbols.length; i += 1) {
    if (!ABIT_SYMBOLS.has(symbols[i])) {
      throw formatError(
        "invalid-abit-symbol",
        `Недопустимый символ ${JSON.stringify(symbols[i])} в позиции ${i}`,
      );
    }
  }
  return {
    format: "mts-anum",
    version: "0.1",
    kind: "quaternary",
    profile: ABIT_PROFILE,
    data: text,
    symbols,
  };
}

export function parseAnums(text) {
  if (text.startsWith("\uFEFF")) throw formatError("bom-not-allowed", "BOM запрещён в .anums");
  assertUnicodeScalars(text);
  return {
    format: "mts-anum",
    version: "0.1",
    kind: "string",
    encoding: "utf-8",
    data: text,
    symbols: Array.from(text),
  };
}

export function parseAnumJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw formatError("invalid-json", error.message);
  }
  if (value?.format !== "mts-anum" || value?.version !== "0.1") {
    throw formatError("unknown-format-version", "Ожидался mts-anum/0.1");
  }
  if (value.kind === "quaternary") return { ...parseAnum4(String(value.data ?? "")), ...value };
  if (value.kind === "string") return { ...parseAnums(String(value.data ?? "")), ...value };
  throw formatError("unknown-anum-kind", `Неизвестный kind: ${value.kind}`);
}

export function parseAsetJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw formatError("invalid-json", error.message);
  }
  const errors = validateAset(value);
  if (errors.length) throw formatError("invalid-aset", errors.join("; "));
  return value;
}

export function parseArtifact(text, format) {
  switch (format) {
    case "anum4":
      return parseAnum4(text);
    case "anums":
      return parseAnums(text);
    case "anum-json":
      return parseAnumJson(text);
    case "aset":
      return parseAsetJson(text);
    default:
      throw formatError("unknown-input-format", `Неизвестный формат: ${format}`);
  }
}

export function serializeArtifact(value, format) {
  switch (format) {
    case "anum4":
      if (value?.kind === "quaternary") return String(value.data ?? "");
      if (value?.provenance?.source?.kind === "quaternary") return String(value.provenance.source.raw ?? "");
      throw formatError("unsupported-round-trip", "В асети нет четверичного исходника для source replay");
    case "anums":
      if (value?.kind === "string") return String(value.data ?? "");
      if (value?.provenance?.source?.kind === "string") return String(value.provenance.source.raw ?? "");
      throw formatError("unsupported-round-trip", "В асети нет строкового исходника для source replay");
    case "anum-json": {
      if (value?.format === "mts-anum") return JSON.stringify(stripDerived(value), null, 2);
      const source = value?.provenance?.source;
      if (!source) throw formatError("unsupported-round-trip", "В асети нет provenance.source");
      return JSON.stringify(
        {
          format: "mts-anum",
          version: "0.1",
          kind: source.kind,
          ...(source.profile ? { profile: source.profile } : {}),
          ...(source.encoding ? { encoding: source.encoding } : {}),
          data: source.raw ?? "",
          provenance: { status: value.provenance?.status ?? "experimental" },
        },
        null,
        2,
      );
    }
    case "aset":
      if (value?.format !== "mts-aset") throw formatError("unsupported-export", "Ожидалась асеть");
      return JSON.stringify(value, null, 2);
    default:
      throw formatError("unknown-output-format", `Неизвестный формат: ${format}`);
  }
}

export function detectFormat(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".aset.json")) return "aset";
  if (lower.endsWith(".anum.json")) return "anum-json";
  if (lower.endsWith(".anum4")) return "anum4";
  if (lower.endsWith(".anums")) return "anums";
  return null;
}

export async function readUtf8File(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw formatError("bom-not-allowed", "UTF-8 BOM запрещён raw-форматами лаборатории");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw formatError("invalid-utf8", error.message);
  }
}

export function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function formatError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertUnicodeScalars(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw formatError("invalid-unicode-scalar", `Непарный старший суррогат в позиции ${i}`);
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw formatError("invalid-unicode-scalar", `Непарный младший суррогат в позиции ${i}`);
    }
  }
}

function stripDerived(value) {
  const copy = { ...value };
  delete copy.symbols;
  return copy;
}
