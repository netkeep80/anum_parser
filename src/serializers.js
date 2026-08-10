import { serializeArtifact } from "./formats.js";
import { validateAset } from "./model.js";

export const SERIALIZERS = [
  {
    id: "aset-json-v0",
    title: "Асеть JSON",
    status: "experimental",
    supports: () => true,
    serialize(aset) {
      assertAset(aset);
      return artifact("experiment.aset.json", serializeArtifact(aset, "aset"), "application/json;charset=utf-8");
    },
  },
  {
    id: "source-replay-v0",
    title: "Точное восстановление исходника",
    status: "experimental",
    supports: (aset) => ["quaternary", "string"].includes(aset?.provenance?.source?.kind),
    serialize(aset) {
      assertAset(aset);
      const kind = aset.provenance?.source?.kind;
      if (kind === "quaternary") {
        return artifact("experiment.anum4", serializeArtifact(aset, "anum4"), "text/plain;charset=utf-8");
      }
      if (kind === "string") {
        return artifact("experiment.anums", serializeArtifact(aset, "anums"), "text/plain;charset=utf-8");
      }
      throw serializerError("unsupported-round-trip", "Нет исходника для точного восстановления");
    },
  },
  {
    id: "source-envelope-v0",
    title: "Самодокументируемый контейнер исходника",
    status: "experimental",
    supports: (aset) => ["quaternary", "string"].includes(aset?.provenance?.source?.kind),
    serialize(aset) {
      assertAset(aset);
      return artifact("experiment.anum.json", serializeArtifact(aset, "anum-json"), "application/json;charset=utf-8");
    },
  },
];

export function serializerById(id) {
  const found = SERIALIZERS.find((item) => item.id === id);
  if (!found) throw serializerError("unknown-serializer", `Неизвестный сериализатор: ${id}`);
  return found;
}

export function availableSerializers(aset) {
  return SERIALIZERS.filter((item) => item.supports(aset));
}

function assertAset(aset) {
  const errors = validateAset(aset);
  if (errors.length) throw serializerError("invalid-aset", errors.join("; "));
}

function artifact(filename, text, mime) {
  return { filename, text, mime };
}

function serializerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
