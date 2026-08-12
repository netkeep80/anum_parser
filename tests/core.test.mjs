import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseAnum4,
  parseAnumJson,
  parseAnums,
  serializeArtifact,
} from "../src/formats.js";
import { availableDeserializers, deserializerById } from "../src/deserializers.js";
import { AsetBuilder, linkMap, validateAset } from "../src/model.js";
import {
  availableSerializers,
  serializerById,
} from "../src/serializers.js";
import { asetToGraphElements } from "../src/visualizer.js";

const corpus = JSON.parse(
  await readFile(new URL("../examples/cases.json", import.meta.url), "utf8"),
);
const ROOT_REFS = new Set(["R", "O", "C", "L", "U"]);

function run(id, source, createStorageLink = false) {
  const artifact = parseAnum4(source);
  return deserializerById(id).deserialize(artifact, { createStorageLink });
}

function accepted(source, createStorageLink = false) {
  return run("anum-v0.4", source, createStorageLink);
}

function parseCorpusSource(item) {
  if (item.format === "anum4") return parseAnum4(item.source);
  if (item.format === "anums") return parseAnums(item.source);
  throw new Error(`unsupported corpus input format: ${item.format}`);
}

function semanticExpression(aset, ref) {
  if (ROOT_REFS.has(ref)) return ref;
  const link = linkMap(aset).get(ref);
  assert.ok(link, `unknown link ref ${ref}`);
  return `(${semanticExpression(aset, link.start)}⟼${semanticExpression(aset, link.end)})`;
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

test("корневой базис R O C L U имеет канонические формы", () => {
  const aset = new AsetBuilder().finish();
  const links = linkMap(aset);
  assert.deepEqual([links.get("R").start, links.get("R").end], ["R", "R"]);
  assert.deepEqual([links.get("O").start, links.get("O").end], ["O", "R"]);
  assert.deepEqual([links.get("C").start, links.get("C").end], ["R", "C"]);
  assert.deepEqual([links.get("L").start, links.get("L").end], ["O", "C"]);
  assert.deepEqual([links.get("U").start, links.get("U").end], ["C", "O"]);
  assert.deepEqual(validateAset(aset), []);
});

test("связь определяется началом и концом", () => {
  const builder = new AsetBuilder();
  const first = builder.link("L", "U");
  const second = builder.link("L", "U");
  assert.equal(first, second);
  const aset = builder.finish();
  assert.equal(aset.links.filter((link) => link.start === "L" && link.end === "U").length, 1);
  assert.deepEqual(validateAset(aset), []);
});

test("валидатор отвергает две записи одной формы", () => {
  const aset = new AsetBuilder().finish();
  aset.links.push({ id: "DUP", start: "R", end: "R" });
  assert.ok(validateAset(aset).some((error) => error.includes("duplicate link form R -> R")));
});

test("реестр содержит один accepted четверичный десериализатор без старого root-wrap id", () => {
  const variants = availableDeserializers("quaternary");
  assert.deepEqual(variants.filter((item) => item.status === "accepted").map((item) => item.id), ["anum-v0.4"]);
  assert.equal(variants.some((item) => item.id === "stack-root-wrap-v0"), false);
  assert.equal(deserializerById("anum-v0.4").status, "accepted");
});

test("accepted ANUM v0.4 совпадает с текущими нормативными векторами", () => {
  const vectors = [
    ["", "R"],
    ["[]", "R"],
    ["1", "L"],
    ["10", "(L⟼U)"],
    ["[1]", "(R⟼L)"],
    ["[[]]", "R"],
    ["1110", "(((L⟼L)⟼L)⟼U)"],
  ];

  for (const [source, expected] of vectors) {
    const result = accepted(source);
    assert.equal(semanticExpression(result.aset, result.result), expected, source || "ε");
    assert.equal(result.aset.provenance.deserializer, "anum-v0.4");
    assert.equal(result.aset.provenance.status, "accepted");
    assert.deepEqual(validateAset(result.aset), []);
  }
});

test("повтор одного абита повторяет ссылку, а не создаёт экземпляры", () => {
  const result = accepted("1110");
  assert.deepEqual(result.aset.abitSequences[0].refs, ["L", "L", "L", "U"]);
  assert.deepEqual(validateAset(result.aset), []);
});

test("[] возвращает акорень, хотя физический carrier содержит O и C", () => {
  const result = accepted("[]");
  assert.equal(result.result, "R");
  assert.notEqual(result.carrier, "R");
  assert.deepEqual(result.aset.abitSequences[0].refs, ["O", "C"]);
});

test("[][] схлопывается в акорень по R = R⟼R", () => {
  const result = accepted("[][]");
  assert.equal(result.result, "R");
  assert.equal(
    result.aset.links.filter((link) => link.start === "R" && link.end === "R").length,
    1,
  );
});

test("[10] в ANUM v0.4 возвращает R⟼(L⟼U)", () => {
  const result = accepted("[10]");
  assert.equal(semanticExpression(result.aset, result.result), "(R⟼(L⟼U))");
  const resultLink = linkMap(result.aset).get(result.result);
  assert.equal(resultLink.start, "R");
  assert.equal(semanticExpression(result.aset, resultLink.end), "(L⟼U)");
});

test("experimental group-value остаётся явным контрастом accepted ANUM v0.4", () => {
  const experimental = run("stack-group-value-v0", "[[10]]");
  const current = accepted("[[10]]");
  assert.equal(semanticExpression(experimental.aset, experimental.result), "(L⟼U)");
  assert.equal(semanticExpression(current.aset, current.result), "(R⟼(R⟼(L⟼U)))");
  assert.notEqual(experimental.result, current.result);
});

test("непарная закрывающая скобка — diagnostic алгоритма, не silent repair", () => {
  assert.throws(
    () => accepted("]"),
    (error) => error.code === "algorithm-undefined-transition" && error.detail.transition === "unexpected-close",
  );
});

test("незакрытый контекст диагностируется", () => {
  assert.throws(
    () => accepted("[10"),
    (error) => error.code === "algorithm-undefined-transition" && error.detail.transition === "unclosed-open",
  );
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

test("одинаковые строковые символы разрешаются в одну связь", () => {
  const { aset } = deserializerById("string-flat-v0").deserialize(parseAnums("aba"));
  const refs = aset.linkSequences[0].items;
  assert.equal(refs[0], refs[2]);
  assert.notEqual(refs[0], refs[1]);
});

test("роль связи-хранилища не создаёт вторую identity той же формы", () => {
  const result = deserializerById("string-flat-v0").deserialize(parseAnums("abc"), {
    createStorageLink: true,
  });
  const stored = result.aset.storedAnums[0];
  const link = linkMap(result.aset).get(stored.storageLink);
  assert.equal(link.start, stored.carrier);
  assert.equal(link.end, stored.denotation);
  assert.deepEqual(validateAset(result.aset), []);
});

test("legacy serializeArtifact source replay остаётся точным", () => {
  const result = accepted("[10]");
  assert.equal(serializeArtifact(result.aset, "anum4"), "[10]");
  assert.throws(() => serializeArtifact(result.aset, "anums"), /нет строкового исходника/);
});

test("serializer registry сохраняет точную строку и четверичный source", () => {
  const q = accepted("[[10]]10");
  const s = deserializerById("string-flat-v0").deserialize(parseAnums("a🙂b\n"));
  const qReplay = serializerById("source-replay-v0").serialize(q.aset);
  const sReplay = serializerById("source-replay-v0").serialize(s.aset);
  assert.equal(qReplay.filename, "experiment.anum4");
  assert.equal(qReplay.text, "[[10]]10");
  assert.equal(sReplay.filename, "experiment.anums");
  assert.equal(sReplay.text, "a🙂b\n");
});

test("source-envelope-v0 round-trip сохраняет физический source", () => {
  const result = accepted("[10][01]");
  const output = serializerById("source-envelope-v0").serialize(result.aset);
  const restored = parseAnumJson(output.text);
  assert.equal(output.filename, "experiment.anum.json");
  assert.equal(restored.kind, "quaternary");
  assert.equal(restored.profile, "mts-abit-v1");
  assert.equal(restored.data, "[10][01]");
});

test("aset-json-v0 сохраняет канонические ids и полюса", () => {
  const result = accepted("[][]", true);
  const output = serializerById("aset-json-v0").serialize(result.aset);
  const restored = JSON.parse(output.text);
  assert.equal(output.filename, "experiment.aset.json");
  assert.deepEqual(restored.links, result.aset.links);
  assert.equal(restored.identity, "by-poles");
  assert.equal(restored.root, result.aset.root);
  assert.deepEqual(validateAset(restored), []);
});

test("Aset без provenance.source не притворяется обратимо сериализуемой в Anum", () => {
  const isolated = structuredClone(accepted("[10]").aset);
  delete isolated.provenance.source;
  assert.deepEqual(availableSerializers(isolated).map((item) => item.id), ["aset-json-v0"]);
  assert.throws(
    () => serializerById("source-replay-v0").serialize(isolated),
    (error) => error.code === "unsupported-round-trip",
  );
});

test("визуальная проекция сохраняет все канонические связи и обе роли полюсов", () => {
  const aset = accepted("[10]").aset;
  const elements = asetToGraphElements(aset);
  const nodes = elements.filter((item) => item.data.source === undefined);
  const edges = elements.filter((item) => item.data.source !== undefined);
  assert.equal(nodes.length, aset.links.length);
  assert.equal(edges.length, aset.links.length * 2);
  assert.equal(nodes.find((item) => item.data.id === "R").data.root, "yes");
  for (const link of aset.links) {
    assert.deepEqual(
      edges.filter((item) => item.data.source === link.id).map((item) => item.data.role),
      ["start", "end"],
    );
  }
});

for (const item of corpus) {
  test(`corpus: ${item.id}`, () => {
    const execute = () => deserializerById(item.algorithm).deserialize(parseCorpusSource(item));
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
