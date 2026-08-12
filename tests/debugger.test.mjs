import assert from "node:assert/strict";
import test from "node:test";

import { parseAnum4 } from "../src/formats.js";
import { deserializerById } from "../src/deserializers.js";
import { linkMap } from "../src/model.js";

function run(source) {
  return deserializerById("anum-v0.4").deserialize(parseAnum4(source));
}

test("трасса 0.3 хранит позицию, stack/top/current и добавляет связи по мере исполнения", () => {
  const result = run("[10]");
  const { trace } = result;
  const links = linkMap(result.aset);

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

  const zeroIndex = trace.findIndex((item) => item.token === "0");
  const zero = trace[zeroIndex];
  assert.equal(zero.resolved, "U");
  assert.equal(links.get(zero.current).start, "L");
  assert.equal(links.get(zero.current).end, "U");
  assert.ok(zero.producedLinks.includes(zero.current));
  assert.ok(zero.visibleLinkIds.includes(zero.current));
  assert.ok(!trace[zeroIndex - 1].visibleLinkIds.includes(zero.current));

  const closeIndex = trace.findIndex((item) => item.token === "]");
  const close = trace[closeIndex];
  assert.equal(close.resolved, "C");
  assert.equal(close.stack.length, 1);
  assert.equal(close.top, 0);
  assert.equal(close.current, result.result);
  assert.equal(links.get(result.result).start, "R");
  assert.equal(links.get(result.result).end, zero.current);
  assert.ok(close.producedLinks.includes(result.result));
  assert.ok(!trace[closeIndex - 1].visibleLinkIds.includes(result.result));
  assert.ok(close.visibleLinkIds.includes(result.result));

  for (let index = 1; index < trace.length; index += 1) {
    assert.ok(trace[index].visibleLinkIds.length >= trace[index - 1].visibleLinkIds.length);
  }
  assert.equal(result.aset.provenance.traceVersion, "0.3");
  assert.equal(result.aset.provenance.deserializer, "anum-v0.4");
  assert.equal(result.aset.provenance.status, "accepted");
});

test("[][] показывает переиспользование R вместо второй связи R⟼R", () => {
  const result = run("[][]");
  const closes = result.trace.filter((item) => item.operation.startsWith("close:"));

  assert.equal(closes.length, 2);
  assert.equal(closes[1].current, "R");
  assert.deepEqual(closes[1].producedLinks, []);
  assert.ok(closes[1].reusedLinks.includes("R"));
  assert.equal(
    result.aset.links.filter((link) => link.start === "R" && link.end === "R").length,
    1,
  );
});
