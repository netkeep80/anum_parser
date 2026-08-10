import { ABIT_REFS, AsetBuilder } from "./model.js";
import { ABIT_PROFILE } from "./formats.js";

export const DESERIALIZERS = [
  {
    id: "string-flat-v0",
    title: "Строка: левая свёртка",
    status: "experimental",
    inputKinds: ["string"],
    description: "Unicode-символы разрешаются в канонические связи; carrier и денотат строятся раздельно.",
    deserialize: deserializeStringFlat,
  },
  {
    id: "abit-flat-v0",
    title: "Абиты: плоская левая свёртка",
    status: "experimental",
    inputKinds: ["quaternary"],
    description: "Baseline: [ ] 1 0 считаются четырьмя корневыми связями без стековой семантики.",
    deserialize: deserializeAbitFlat,
  },
  {
    id: "stack-group-value-v0",
    title: "Стек: группа возвращает значение",
    status: "experimental",
    inputKinds: ["quaternary"],
    description: "[ открывает контекст от ∞, ] передаёт внутренний результат родителю как одно значение.",
    deserialize: (artifact, options) => deserializeStack(artifact, { ...options, closeStrategy: "group-value" }),
  },
  {
    id: "stack-root-wrap-v0",
    title: "Стек: непустая группа возвращает ∞⟼value",
    status: "experimental",
    inputKinds: ["quaternary"],
    description: "Как stack-group-value, но CLOSE непустой группы получает связь ∞⟼value по обычному правилу МТС.",
    deserialize: (artifact, options) => deserializeStack(artifact, { ...options, closeStrategy: "root-wrap" }),
  },
];

export function deserializerById(id) {
  const found = DESERIALIZERS.find((item) => item.id === id);
  if (!found) throw new Error(`unknown deserializer: ${id}`);
  return found;
}

export function availableDeserializers(kind) {
  return DESERIALIZERS.filter((item) => item.inputKinds.includes(kind));
}

function deserializeStringFlat(artifact, options = {}) {
  assertKind(artifact, "string");
  const builder = sourceBuilder(artifact);
  const trace = [];
  const refs = artifact.symbols.map((symbol, index) => {
    const ref = builder.symbolValue(symbol);
    trace.push(step(index, symbol, "resolve-symbol", 0, ref, [ref], [], `UTF-8 символ ${JSON.stringify(symbol)} -> ${ref}`));
    return ref;
  });
  const sourceSequence = builder.addSymbolSequence(artifact.data, artifact.symbols);
  const linkSequence = builder.addLinkSequence(refs, { role: "resolved-symbol-values" });
  const carrier = builder.rootChain(refs, { sourceSequence: linkSequence });
  const folded = builder.leftFold(refs, { labelPrefix: "string-fold" });
  trace.push(step(trace.length, "", "finish", 0, folded.result, refs, folded.created, "Левая свёртка строковых значений"));
  finish(builder, artifact, {
    algorithm: "string-flat-v0",
    sourceSequence,
    linkSequence,
    carrier: carrier.head,
    denotation: folded.result,
    options,
  });
  maybeStore(builder, carrier.head, folded.result, options);
  return { aset: builder.finish(), trace, result: folded.result, carrier: carrier.head };
}

function deserializeAbitFlat(artifact, options = {}) {
  assertKind(artifact, "quaternary");
  const { builder, refs, sourceSequence, abitSequence } = prepareAbits(artifact);
  const trace = refs.map((ref, index) =>
    step(index, artifact.symbols[index], "resolve-abit", 0, ref, [ref], [], `${artifact.symbols[index]} -> ${ref}`),
  );
  const physicalLinks = builder.addLinkSequence(refs, { role: "physical-abit-values" });
  const carrier = builder.rootChain(refs, { sourceSequence: physicalLinks });
  const folded = builder.leftFold(refs, { labelPrefix: "abit-flat-fold" });
  trace.push(step(trace.length, "", "finish", 0, folded.result, refs, folded.created, "Плоская свёртка всех абитов"));
  finish(builder, artifact, {
    algorithm: "abit-flat-v0",
    sourceSequence,
    abitSequence,
    linkSequence: physicalLinks,
    carrier: carrier.head,
    denotation: folded.result,
    options,
  });
  maybeStore(builder, carrier.head, folded.result, options);
  return { aset: builder.finish(), trace, result: folded.result, carrier: carrier.head };
}

function deserializeStack(artifact, options = {}) {
  assertKind(artifact, "quaternary");
  const { builder, refs, sourceSequence, abitSequence } = prepareAbits(artifact);
  const physicalLinks = builder.addLinkSequence(refs, { role: "physical-abit-values" });
  const carrier = builder.rootChain(refs, { sourceSequence: physicalLinks });
  const trace = [];
  const frames = [newFrame(null)];

  for (let index = 0; index < artifact.symbols.length; index += 1) {
    const token = artifact.symbols[index];
    const ref = refs[index];
    if (token === "[") {
      frames.push(newFrame(index));
      trace.push(snapshot(index, token, "open", frames, [], "Сохранить внешний контекст; новый current = ∞"));
      continue;
    }
    if (token === "]") {
      if (frames.length === 1) {
        throw transitionError("unexpected-close", index, token, "Нет открытого контекста для ]");
      }
      const inner = frames.pop();
      let returned = inner.started ? inner.current : "R";
      const produced = [];
      if (options.closeStrategy === "root-wrap" && inner.started) {
        const ensured = builder.ensureLink("R", returned, {
          label: `close-wrap:${index}`,
          tags: ["experimental-close-wrap"],
        });
        returned = ensured.ref;
        if (ensured.created) produced.push(returned);
      }
      appendValue(builder, frames.at(-1), returned, produced, `close:${index}`);
      trace.push(snapshot(index, token, `close:${options.closeStrategy}`, frames, produced, `Группа вернула ${returned}`));
      continue;
    }
    appendValue(builder, frames.at(-1), ref, [], `value:${index}`);
    trace.push(snapshot(index, token, "value", frames, [], `Добавить связь-абит ${ref} в текущий контекст`));
  }

  if (frames.length !== 1) {
    const open = frames.at(-1).openIndex;
    throw transitionError("unclosed-open", open, "[", `Контекст, открытый в позиции ${open}, не закрыт`);
  }

  const rootFrame = frames[0];
  const result = rootFrame.started ? rootFrame.current : "R";
  const resultSequence = builder.addLinkSequence(rootFrame.values, { role: "top-level-values" });
  trace.push(snapshot(trace.length, "", "finish", frames, [], `Результат верхнего контекста: ${result}`));
  finish(builder, artifact, {
    algorithm: options.closeStrategy === "root-wrap" ? "stack-root-wrap-v0" : "stack-group-value-v0",
    sourceSequence,
    abitSequence,
    linkSequence: physicalLinks,
    resultSequence,
    carrier: carrier.head,
    denotation: result,
    options,
  });
  maybeStore(builder, carrier.head, result, options);
  return { aset: builder.finish(), trace, result, carrier: carrier.head };
}

function prepareAbits(artifact) {
  const builder = sourceBuilder(artifact);
  const sourceSequence = builder.addSymbolSequence(artifact.data, artifact.symbols, {
    kind: "ascii-abit-source",
  });
  const refs = artifact.symbols.map((symbol) => ABIT_REFS[symbol]);
  const abitSequence = builder.addAbitSequence(artifact.symbols, refs, { profile: ABIT_PROFILE });
  return { builder, refs, sourceSequence, abitSequence };
}

function sourceBuilder(artifact) {
  return new AsetBuilder({
    source: {
      kind: artifact.kind,
      ...(artifact.profile ? { profile: artifact.profile } : {}),
      ...(artifact.encoding ? { encoding: artifact.encoding } : {}),
      raw: artifact.data,
    },
  });
}

function newFrame(openIndex) {
  return { openIndex, values: [], current: "R", started: false };
}

function appendValue(builder, frame, value, produced, label) {
  frame.values.push(value);
  if (!frame.started) {
    frame.current = value;
    frame.started = true;
    return;
  }
  const ensured = builder.ensureLink(frame.current, value, {
    label,
    tags: ["sequence-fold-step"],
  });
  frame.current = ensured.ref;
  if (ensured.created) produced.push(frame.current);
}

function snapshot(index, token, operation, frames, producedLinks, note) {
  const frame = frames.at(-1);
  return step(
    index,
    token,
    operation,
    frames.length - 1,
    frame.started ? frame.current : "R",
    frame.values,
    producedLinks,
    note,
  );
}

function step(stepIndex, token, operation, depth, current, values, producedLinks, note) {
  return {
    step: stepIndex,
    token,
    operation,
    depth,
    current,
    values: [...values],
    producedLinks: [...producedLinks],
    note,
  };
}

function finish(builder, artifact, data) {
  builder.setProvenance({
    status: "experimental",
    deserializer: data.algorithm,
    traceVersion: "0.2",
    representations: {
      sourceSequence: data.sourceSequence,
      ...(data.abitSequence ? { abitSequence: data.abitSequence } : {}),
      ...(data.linkSequence ? { linkSequence: data.linkSequence } : {}),
      ...(data.resultSequence ? { resultSequence: data.resultSequence } : {}),
      carrier: data.carrier,
      denotation: data.denotation,
    },
  });
}

function maybeStore(builder, carrier, denotation, options) {
  if (options?.createStorageLink) {
    builder.storeAnum(carrier, denotation);
  }
}

function assertKind(artifact, expected) {
  if (artifact.kind !== expected) throw new Error(`expected ${expected}, got ${artifact.kind}`);
}

function transitionError(code, index, token, message) {
  const error = new Error(message);
  error.code = "algorithm-undefined-transition";
  error.detail = { transition: code, index, token };
  return error;
}
