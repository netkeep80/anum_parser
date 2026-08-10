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
import { AsetBuilder, linkMap, validateAset } from "../src/model.js";
import {
  availableSerializers,
  serializerById,
} from "../src/serializers.js";
import { asetToGraphElements } from "../src/visualizer.js";

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
  const errors = validateAset(aset);
  assert.ok(errors.some((error) => error.includes("duplicate link form R -> R")));
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

test("повтор одного абита повторяет ссылку, а не создаёт экземпляры", () => {
  const result = run("abit-flat-v0", "1110");
  assert.deepEqual(result.aset.abitSequences[0].refs, ["L", "L", "L", "U"]);
  assert.deepEqual(validateAset(result.aset), []);
});

test("пустой ввод stack-group-value возвращает акорень", () => {
  const result = run("stack-group-value-v0", "");
  assert.equal(result.result, "R");
  assert.equal(result.carrier, "R");
});

test("[] возвращает акорень", () => {
  const result = run("stack-group-value-v0", "[]");
  assert.equal(result.result, "R");
  assert.notEqual(result.carrier, "R", "физический carrier [] содержит O и C");
  assert.deepEqual(result.aset.abitSequences[0].refs, ["O", "C"]);
});

test("[][] схлопывается в акорень по R = R⟼R", () => {
  const result = run("stack-group-value-v0", "[][]");
  assert.equal(result.result, "R");
  assert.equal(
    result.aset.links.filter((link) => link.start === "R" && link.end === "R").length,
    1,
  );
});

test("стековая трасса хранит позицию, stack/top/current и видимую асеть", () => {
  const result = run("stack-group-value-v0", "[10]");
  const { trace } = result;
  assert.equal(trace[0].operation, "start");
  assert.equal(trace[0].sourceIndex, -1);
  assert.equal(trace[0].stack.length, 1);
  assert.equal(trace[0].top, 0);
  assert.equal(trace[0].current, "R");
  assert.ok(trace[0].visibleLinkIds.includes("R"));

  const open = trace.find((item) => item.token === "[");
  assert.equal(open.resolved, "O");
  assert.equal(open.stack.length, 2);
  assert.equal(open.top, 1);
  assert.equal(open.stack[1].current, "R");

  const zero = trace.find((item) => item.token === "0");
  assert.equal(zero.resolved, "U");
  assert.equal(zero.current, result.result);
  assert.ok(zero.producedLinks.includes(result.result));
  assert.ok(zero.visibleLinkIds.includes(result.result));

  const close = trace.find((item) => item.token === "]");
  assert.equal(close.resolved, "C");
  assert.equal(close.stack.length, 1);
  assert.equal(close.top, 0);

  for (let i = 1; i < trace.length; i += 1) {
    assert.ok(trace[i].visibleLinkIds.length >= trace[i - 1].visibleLinkIds.length);
  }
  assert.equal(result.aset.provenance.traceVersion, "0.3");
});

test("[][] показывает переиспользование R вместо создания второй связи R⟼R", () => {
  const result = run("stack-group-value-v0", "[][]");
  const closes = result.trace.filter((item) => item.operation.startsWith("close:"));
  assert.equal(closes.length, 2);
  assert.equal(closes[1].current, "R");
  assert.deepEqual(closes[1].producedLinks, []);
  assert.ok(closes[1].reusedLinks.includes("R"));
  assert.equal(result.aset.links.filter((link) => link.start === "R" && link.end === "R").length, 1);
});

test("[10] строит denotation 1⟼0 без root как операнда непустого body", () => {
  const result = run("stack-group-value-v0", "[10]");
  const links = linkMap(result.aset);
  const refs = result.aset.abitSequences[0].refs;
  const one = refs[1];
  const zero = refs[2];
  assert.equal(one, "L");
  assert.equal(zero, "U");
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

test("роль связи-хранилища не создаёт вторую identity той же формы", () => {
  const result = deserializerById("string-flat-v0").deserialize(parseAnums("abc"), {
    createStorageLink: true,
  });
  const stored = result.aset.storedAnums[0];
  assert.ok(stored);
  const link = linkMap(result.aset).get(stored.storageLink);
  assert.equal(link.start, stored.carrier);
  assert.equal(link.end, stored.denotation);
  assert.deepEqual(validateAset(result.aset), []);
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

test("aset-json-v0 сохраняет канонические ids и полюса", () => {
  const result = run("stack-group-value-v0", "[][]", true);
  const output = serializerById("aset-json-v0").serialize(result.aset);
  const restored = JSON.parse(output.text);

  assert.equal(output.filename, "experiment.aset.json");
  assert.deepEqual(restored.links, result.aset.links);
  assert.equal(restored.identity, "by-poles");
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

test("визуальная проекция сохраняет все канонические связи и обе роли полюсов", () => {
  const aset = run("stack-group-value-v0", "[10]").aset;
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
