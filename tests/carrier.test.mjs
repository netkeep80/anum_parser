import assert from "node:assert/strict";
import test from "node:test";

import {
  carrierFromProvenance,
  CarrierInputError,
  decodeCarrierStream,
} from "../src/carrier.js";
import { availableDeserializers, deserializerById } from "../src/deserializers.js";
import { parseAnum4, parseArtifact } from "../src/formats.js";
import { AsetBuilder, linkMap } from "../src/model.js";

const ROOT_REFS = new Set(["R", "O", "C", "L", "U"]);

function accepted(source) {
  return deserializerById("anum-v0.4").deserialize(parseAnum4(source));
}

function semanticExpression(aset, ref) {
  if (ROOT_REFS.has(ref)) return ref;
  const link = linkMap(aset).get(ref);
  assert.ok(link, `unknown link ref ${ref}`);
  return `(${semanticExpression(aset, link.start)}⟼${semanticExpression(aset, link.end)})`;
}

test("режим aset-carrier использует тот же accepted anum-v0.4", () => {
  const variants = availableDeserializers("aset-carrier");
  assert.deepEqual(variants.map((item) => item.id), ["anum-v0.4"]);
  assert.equal(variants[0].status, "accepted");
});

test("existing carrier восстанавливает точный четверичный поток по start-истории", () => {
  const vectors = ["", "[]", "1", "10", "[1]", "[[]]", "1110", "[10]", "[1][0]"];

  for (const source of vectors) {
    const raw = accepted(source);
    const carrier = carrierFromProvenance(raw.aset);
    const before = JSON.stringify(raw.aset);
    const decoded = decodeCarrierStream(raw.aset, carrier);

    assert.equal(decoded.source, source, source || "ε");
    assert.equal(decoded.sequence.prefixes[0], "R");
    assert.equal(decoded.sequence.prefixes.at(-1), carrier);
    assert.equal(JSON.stringify(raw.aset), before, "чтение carrier не должно менять исходную асеть");
  }
});

test("raw и existing carrier сходятся до одной stack machine и одного денотата", () => {
  const raw = accepted("[10]");
  const imported = parseArtifact(JSON.stringify(raw.aset), "aset-carrier");
  const before = JSON.stringify(imported);
  const fromCarrier = deserializerById("anum-v0.4").deserialize(imported);

  assert.equal(JSON.stringify(imported), before, "десериализация carrier должна быть read-only для входной асети");
  assert.equal(
    semanticExpression(fromCarrier.aset, fromCarrier.result),
    semanticExpression(raw.aset, raw.result),
  );
  assert.deepEqual(
    fromCarrier.trace.map((item) => item.operation),
    raw.trace.map((item) => item.operation),
  );
  assert.equal(fromCarrier.aset.provenance.source.raw, "[10]");
  assert.deepEqual(fromCarrier.aset.provenance.transport, {
    kind: "existing-carrier",
    carrierRef: raw.carrier,
    readOnly: true,
    decodedBeforeStackMachine: true,
    sourceAset: "mts-aset/0.2",
    prefixCount: raw.aset.abitSequences[0].refs.length + 1,
  });
});

test("роль carrier должна быть выбрана явно в provenance", () => {
  const aset = new AsetBuilder().finish();
  assert.throws(
    () => carrierFromProvenance(aset),
    (error) => error instanceof CarrierInputError && error.code === "carrier-not-selected",
  );
  assert.throws(
    () => deserializerById("anum-v0.4").deserialize(aset),
    (error) => error instanceof CarrierInputError && error.code === "carrier-not-selected",
  );
});

test("самозамкнутая start-история не притворяется конечным R-rooted carrier", () => {
  const aset = new AsetBuilder().finish();
  assert.throws(
    () => decodeCarrierStream(aset, "O"),
    (error) => error instanceof CarrierInputError && error.code === "not-rooted-sequence",
  );
});

test("R-rooted последовательность с не-абитом отвергается на транспортной границе", () => {
  const builder = new AsetBuilder();
  const foreignValue = builder.link("L", "U");
  const carrier = builder.rootChain([foreignValue]).head;
  const aset = builder.finish();

  assert.throws(
    () => decodeCarrierStream(aset, carrier),
    (error) => error instanceof CarrierInputError && error.code === "non-abit",
  );
});

test("неизвестная техническая ссылка carrier отвергается отдельно", () => {
  const aset = new AsetBuilder().finish();
  assert.throws(
    () => decodeCarrierStream(aset, "missing"),
    (error) => error instanceof CarrierInputError && error.code === "unknown-carrier",
  );
});
