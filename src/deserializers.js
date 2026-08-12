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
    id: "anum-v0.4",
    title: "ANUM v0.4: принятая стековая десериализация",
    status: "accepted",
    inputKinds: ["quaternary"],
    description: "[ открывает контекст от ∞; пустой ] возвращает ∞, непустой ] возвращает ∞⟼value.",
    deserialize: (artifact, options) => deserializeStack(artifact, {
      ...options,
      algorithm: "anum-v0.4",
      status: "accepted",
      closeStrategy: "root-wrap",
    }),
  },
  {
    id: "stack-group-value-v0",
    title: "Эксперимент: группа возвращает value без ∞-обёртки",
    status: "experimental",
    inputKinds: ["quaternary"],
    description: "Историко-экспериментальный контраст к ANUM v0.4: ] передаёт внутренний результат напрямую.",
    deserialize: (artifact, options) => deserializeStack(artifact, {
      ...options,
      algorithm: "stack-group-value-v0",
      status: "experimental",
      closeStrategy: "group-value",
    }),
  },
  {
    id: "abit-flat-v0",
    title: "Абиты: плоская левая свёртка",
    status: "experimental",
    inputKinds: ["quaternary"],
    description: "Контрольный вариант: [ ] 1 0 считаются четырьмя корневыми связями без стековой семантики.",
    deserialize: deserializeAbitFlat,
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
    const before = linkIdSet(builder);
    const ref = builder.symbolValue(symbol);
    const produced = newLinksSince(builder, before);
    trace.push(simpleStep(builder, trace.length, index, symbol, ref, "resolve-symbol", ref, produced,
      `UTF-8 символ ${JSON.stringify(symbol)} -> ${ref}`));
    return ref;
  });
  const sourceSequence = builder.addSymbolSequence(artifact.data, artifact.symbols);
  const linkSequence = builder.addLinkSequence(refs, { role: "resolved-symbol-values" });
  const carrier = builder.rootChain(refs, { sourceSequence: linkSequence });
  const folded = builder.leftFold(refs, { labelPrefix: "string-fold" });
  trace.push(simpleStep(builder, trace.length, artifact.symbols.length, "", null, "finish", folded.result,
    folded.created, "Левая свёртка строковых значений"));
  finish(builder, artifact, {
    algorithm: "string-flat-v0",
    status: "experimental",
    sourceSequence,
    linkSequence,
    carrier: carrier.head,
    denotation: folded.result,
  });
  maybeStore(builder, carrier.head, folded.result, options);
  return { aset: builder.finish(), trace, result: folded.result, carrier: carrier.head };
}

function deserializeAbitFlat(artifact, options = {}) {
  assertKind(artifact, "quaternary");
  const { builder, refs, sourceSequence, abitSequence } = prepareAbits(artifact);
  const physicalLinks = builder.addLinkSequence(refs, { role: "physical-abit-values" });
  const carrier = builder.rootChain(refs, { sourceSequence: physicalLinks });
  const trace = refs.map((ref, index) =>
    simpleStep(builder, index, index, artifact.symbols[index], ref, "resolve-abit", ref, [],
      `${artifact.symbols[index]} -> ${ref}`),
  );
  const folded = builder.leftFold(refs, { labelPrefix: "abit-flat-fold" });
  trace.push(simpleStep(builder, trace.length, artifact.symbols.length, "", null, "finish", folded.result,
    folded.created, "Плоская свёртка всех абитов"));
  finish(builder, artifact, {
    algorithm: "abit-flat-v0",
    status: "experimental",
    sourceSequence,
    abitSequence,
    linkSequence: physicalLinks,
    carrier: carrier.head,
    denotation: folded.result,
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

  trace.push(snapshot(builder, trace.length, -1, "", null, "start", frames, [], [],
    "Исходная запись и её carrier загружены; выполнение десериализатора ещё не начато"));

  for (let index = 0; index < artifact.symbols.length; index += 1) {
    const token = artifact.symbols[index];
    const ref = refs[index];
    if (token === "[") {
      frames.push(newFrame(index));
      trace.push(snapshot(builder, trace.length, index, token, ref, "open", frames, [], [],
        "Сохранить внешний контекст; новый current = ∞"));
      continue;
    }
    if (token === "]") {
      if (frames.length === 1) {
        throw transitionError("unexpected-close", index, token, "Нет открытого контекста для ]");
      }
      const inner = frames.pop();
      let returned = inner.started ? inner.current : "R";
      const produced = [];
      const reused = [];
      if (options.closeStrategy === "root-wrap" && inner.started) {
        const ensured = builder.ensureLink("R", returned, {
          label: `close-wrap:${index}`,
          tags: ["sequence-group-close"],
        });
        returned = ensured.ref;
        recordEnsured(ensured, produced, reused);
      }
      appendValue(builder, frames.at(-1), returned, produced, reused, `close:${index}`);
      trace.push(snapshot(builder, trace.length, index, token, ref, `close:${options.closeStrategy}`,
        frames, produced, reused, `Группа вернула ${returned}`));
      continue;
    }

    const produced = [];
    const reused = [];
    appendValue(builder, frames.at(-1), ref, produced, reused, `value:${index}`);
    trace.push(snapshot(builder, trace.length, index, token, ref, "value", frames, produced, reused,
      `Добавить связь-абит ${ref} в текущий контекст`));
  }

  if (frames.length !== 1) {
    const open = frames.at(-1).openIndex;
    throw transitionError("unclosed-open", open, "[", `Контекст, открытый в позиции ${open}, не закрыт`);
  }

  const rootFrame = frames[0];
  const result = rootFrame.started ? rootFrame.current : "R";
  const resultSequence = builder.addLinkSequence(rootFrame.values, { role: "top-level-values" });
  finish(builder, artifact, {
    algorithm: options.algorithm,
    status: options.status,
    sourceSequence,
    abitSequence,
    linkSequence: physicalLinks,
    resultSequence,
    carrier: carrier.head,
    denotation: result,
  });
  maybeStore(builder, carrier.head, result, options);
  trace.push(snapshot(builder, trace.length, artifact.symbols.length, "", null, "finish", frames, [], [],
    `Результат верхнего контекста: ${result}`));
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

function appendValue(builder, frame, value, produced, reused, label) {
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
  recordEnsured(ensured, produced, reused);
}

function recordEnsured(ensured, produced, reused) {
  const target = ensured.created ? produced : reused;
  if (!target.includes(ensured.ref)) target.push(ensured.ref);
}

function snapshot(builder, stepIndex, sourceIndex, token, resolved, operation, frames, producedLinks, reusedLinks, note) {
  const frame = frames.at(-1);
  return {
    step: stepIndex,
    sourceIndex,
    token,
    resolved,
    operation,
    depth: frames.length - 1,
    top: frames.length - 1,
    current: frame.started ? frame.current : "R",
    values: [...frame.values],
    stack: frames.map((item, level) => ({
      level,
      openIndex: item.openIndex,
      current: item.started ? item.current : "R",
      started: item.started,
      values: [...item.values],
    })),
    producedLinks: [...producedLinks],
    reusedLinks: [...reusedLinks],
    visibleLinkIds: builder.aset.links.map((link) => link.id),
    note,
  };
}

function simpleStep(builder, stepIndex, sourceIndex, token, resolved, operation, current, producedLinks, note) {
  return {
    step: stepIndex,
    sourceIndex,
    token,
    resolved,
    operation,
    depth: 0,
    top: 0,
    current,
    values: current ? [current] : [],
    stack: [],
    producedLinks: [...producedLinks],
    reusedLinks: [],
    visibleLinkIds: builder.aset.links.map((link) => link.id),
    note,
  };
}

function linkIdSet(builder) {
  return new Set(builder.aset.links.map((link) => link.id));
}

function newLinksSince(builder, before) {
  return builder.aset.links.map((link) => link.id).filter((id) => !before.has(id));
}

function finish(builder, artifact, data) {
  builder.setProvenance({
    status: data.status ?? "experimental",
    deserializer: data.algorithm,
    traceVersion: "0.3",
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
