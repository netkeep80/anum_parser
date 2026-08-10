import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseAnum4,
  parseAnumJson,
  parseAnums,
  serializeArtifact,
} from "../src/formats.js";
import { deserializerById } from "../src/deserializers.js";
import { linkMap, validateAset } from "../src/model.js";
import {
  availableSerializers,
  serializerById,
} from "../src/serializers.js";

const corpus = JSON.parse(
  await readFile(new URL("../examples/cases.json", import.meta.url), "utf8"),
);

function run(id, source, createStorageLink = false) {
  const artifact = parseAnum4(source);
  return deserializerById(id).deserialize(artifact, { createStorageLink });
}

function parseCorpusSource(item) {
  if (item.format === "anum4") return parseAnum4(item.source);
  if (item.format === "anums") return parseAnums(item.source);
  throw new Error(`unsupported corpus input format: ${item.format}`);
}

test(".anum4 хранит только четыре физических символа", () => {
  assert.deepEqual(parseAnum4("[10]").symbols, ["[", "1", "0", "]"]);
  assert.deepEqual(parseAnum4("").symbols, []);
  assert.throws(() => parseAnum4("[1 0]"), /Недопустимый символ/);
  assert.throws(() => parseAnum4("∞"), /Недопустимый символ/);
});

test(".anums не нормализует Unicode", () => {
  const nfc = parseAnums("é");
  const nfd = parseAnums("e\u0301");
  assert.equal(nfc.symbols.length, 1);
  assert.equal(nfd.symbols.length, 2);
  assert.notEqual(nfc.data, nfd.data);
});

test("строка abc различает symbol sequence, link sequence, carrier и denotation", () => {
  const result = deserializerById("string-flat-v0").deserialize(parseAnums("abc"));
  const { aset } = result;
  assert.equal(aset.symbolSequences[0].text, "abc");
  assert.equal(aset.linkSequences[0].items.length, 3);
  assert.equal(aset.rootChains.length, 1);
  assert.notEqual(result.carrier, result.result);
  assert.equal(aset.rootChains[0].head, result.carrier);
  assert.equal(aset.provenance.representations.denotation, result.result);
  assert.deepEqual(validateAset(aset), []);
});

test("symbol occurrences exact-различны даже при одинаковых полюсах", () => {
  const { aset } = deserializerById("string-flat-v0").deserialize(parseAnums("aa"));
  const refs = aset.linkSequences[0].items;
  const links = linkMap(aset);
  assert.notEqual(refs[0], refs[1]);
  assert.deepEqual(
    [links.get(refs[0]).start, links.get(refs[0]).end],
    [links.get(refs[1]).start, links.get(refs[1]).end],
  );
});

test("пустой ввод stack-group-value возвращает distinguished root", () => {
  const result = run("stack-group-value-v0", "");
  assert.equal(result.result, "R");
  assert.equal(result.carrier, "R");
});

test("[] возвращает root в stack-group-value-v0", () => {
  const result = run("stack-group-value-v0", "[]");
  assert.equal(result.result, "R");
  assert.notEqual(result.carrier, "R", "физический carrier [] всё равно содержит два абита");
  assert.equal(result.aset.abitSequences[0].symbols.join(""), "[]");
});

test("[][] создаёт новый root-shaped result, но не подменяет distinguished root", () => {
  const result = run("stack-group-value-v0", "[][]");
  const link = linkMap(result.aset).get(result.result);
  assert.notEqual(result.result, "R");
  assert.equal(link.start, "R");
  assert.equal(link.end, "R");
});

test("[10] строит denotation 1⟼0 без root как операнда непустого body", () => {
  const result = run("stack-group-value-v0", "[10]");
  const links = linkMap(result.aset);
  const refs = result.aset.abitSequences[0].refs;
  const one = refs[1];
  const zero = refs[2];
  const denotation = links.get(result.result);
  assert.equal(denotation.start, one);
  assert.equal(denotation.end, zero);
});

test("два CLOSE profile дают разные топологии для [[10]]", () => {
  const groupValue = run("stack-group-value-v0", "[[10]]");
  const rootWrap = run("stack-root-wrap-v0", "[[10]]");
  const groupLink = linkMap(groupValue.aset).get(groupValue.result);
  const wrapLink = linkMap(rootWrap.aset).get(rootWrap.result);
  assert.notEqual(groupLink.start, "R");
  assert.equal(wrapLink.start, "R");
  assert.ok(rootWrap.aset.links.length > groupValue.aset.links.length);
});

test("непарная закрывающая скобка — diagnostic алгоритма, не silent repair", () => {
  assert.throws(
    () => run("stack-group-value-v0", "]"),
    (error) => error.code === "algorithm-undefined-transition" && error.detail.transition === "unexpected-close",
  );
});

test("незакрытый контекст диагностируется", () => {
  assert.throws(
    () => run("stack-group-value-v0", "[10"),
    (error) => error.code === "algorithm-undefined-transition" && error.detail.transition === "unclosed-open",
  );
});

test("storage-link является отдельной exact связью", () => {
  const result = deserializerById("string-flat-v0").deserialize(parseAnums("abc"), {
    createStorageLink: true,
  });
  const stored = result.aset.storedAnums[0];
  assert.ok(stored);
  assert.notEqual(stored.storageLink, stored.carrier);
  assert.notEqual(stored.storageLink, stored.denotation);
  const link = linkMap(result.aset).get(stored.storageLink);
  assert.equal(link.start, stored.carrier);
  assert.equal(link.end, stored.denotation);
});

test("legacy serializeArtifact source replay остаётся точным", () => {
  const result = run("stack-group-value-v0", "[10]");
  assert.equal(serializeArtifact(result.aset, "anum4"), "[10]");
  assert.throws(() => serializeArtifact(result.aset, "anums"), /нет строкового исходника/);
});

test("serializer registry сохраняет точную строку и четверичный source", () => {
  const q = run("stack-group-value-v0", "[[10]]10");
  const s = deserializerById("string-flat-v0").deserialize(parseAnums("a🙂b\n"));

  const qReplay = serializerById("source-replay-v0").serialize(q.aset);
  const sReplay = serializerById("source-replay-v0").serialize(s.aset);

  assert.equal(qReplay.filename, "experiment.anum4");
  assert.equal(qReplay.text, "[[10]]10");
  assert.equal(sReplay.filename, "experiment.anums");
  assert.equal(sReplay.text, "a🙂b\n");
});

test("source-envelope-v0 round-trip сохраняет физический source", () => {
  const result = run("stack-root-wrap-v0", "[10][01]");
  const output = serializerById("source-envelope-v0").serialize(result.aset);
  const restored = parseAnumJson(output.text);

  assert.equal(output.filename, "experiment.anum.json");
  assert.equal(restored.kind, "quaternary");
  assert.equal(restored.profile, "mts-abit-v1");
  assert.equal(restored.data, "[10][01]");
});

test("aset-json-v0 сохраняет exact ids и полюса", () => {
  const result = run("stack-group-value-v0", "[][]", true);
  const output = serializerById("aset-json-v0").serialize(result.aset);
  const restored = JSON.parse(output.text);

  assert.equal(output.filename, "experiment.aset.json");
  assert.deepEqual(restored.links, result.aset.links);
  assert.equal(restored.root, result.aset.root);
  assert.deepEqual(validateAset(restored), []);
});

test("Aset без provenance.source не притворяется обратимо сериализуемой в Anum", () => {
  const result = run("stack-group-value-v0", "[10]");
  const isolated = structuredClone(result.aset);
  delete isolated.provenance.source;

  assert.deepEqual(
    availableSerializers(isolated).map((item) => item.id),
    ["aset-json-v0"],
  );
  assert.throws(
    () => serializerById("source-replay-v0").serialize(isolated),
    (error) => error.code === "unsupported-round-trip",
  );
});

for (const item of corpus) {
  test(`corpus: ${item.id}`, () => {
    const execute = () => {
      const artifact = parseCorpusSource(item);
      return deserializerById(item.algorithm).deserialize(artifact);
    };

    if (item.expectError) {
      assert.throws(
        execute,
        (error) => error.code === item.expectError,
        `${item.id} должен завершаться ${item.expectError}`,
      );
      return;
    }

    const result = execute();
    assert.deepEqual(validateAset(result.aset), [], item.id);
    assert.equal(result.aset.provenance?.source?.raw, item.source, item.id);
    assert.ok(result.aset.links.some((link) => link.id === result.result), item.id);
  });
}
