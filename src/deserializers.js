import { executeAbits } from "../generated/mts-core/public.js";
import { MTS_CORE_PROVENANCE } from "../generated/mts-core-provenance.js";
import { ABIT_REFS, AsetBuilder } from "./model.js";
import { ABIT_PROFILE, parseAnum4 } from "./formats.js";
import { carrierFromProvenance, decodeCarrierStream } from "./carrier.js";

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
    title: "ANUM: accepted @mts/core / MTS v0.10",
    status: "accepted",
    inputKinds: ["quaternary", "aset-carrier"],
    description: "Строгий поток [ ] 1 0 исполняется exact-pinned @mts/core; локальная асеть и trace являются проекцией upstream execution.",
    deserialize: deserializeAccepted,
  },
  {
    id: "stack-group-value-v0",
    title: "Эксперимент: группа возвращает value без ∞-обёртки",
    status: "experimental",
    inputKinds: ["quaternary"],
    description: "Историко-экспериментальный контраст к accepted @mts/core: ] передаёт внутренний результат напрямую.",
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

function deserializeAccepted(artifact, options = {}) {
  if (artifact?.format !== "mts-aset") {
    return deserializeAcceptedCore(artifact, options);
  }

  const carrierRef = carrierFromProvenance(artifact);
  const decoded = decodeCarrierStream(artifact, carrierRef);
  const result = deserializeAcceptedCore(parseAnum4(decoded.source), options);
  result.aset.provenance.transport = {
    kind: "existing-carrier",
    carrierRef,
    readOnly: true,
    decodedBeforeAcceptedRuntime: true,
    sourceAset: `${artifact.format}/${artifact.version}`,
    prefixCount: decoded.sequence.prefixes.length,
  };
  return result;
}

function deserializeAcceptedCore(artifact, options = {}) {
  assertKind(artifact, "quaternary");
  const { builder, refs, sourceSequence, abitSequence } = prepareAbits(artifact);
  const physicalLinks = builder.addLinkSequence(refs, { role: "physical-abit-values" });
  const carrier = builder.rootChain(refs, { sourceSequence: physicalLinks });
  const initialVisibleLinkIds = builder.aset.links.map((link) => link.id);
  const linkEvents = artifact.symbols.map(() => []);
  const visibleAfter = artifact.symbols.map(() => []);
  let sourceIndex = -1;

  const algebra = {
    root: "R",
    linked: "L",
    unlinked: "U",
    link(start, end) {
      if (sourceIndex < 0 || sourceIndex >= artifact.symbols.length) {
        throw new Error("@mts/core requested a semantic link outside a source step");
      }
      const ensured = builder.ensureLink(start, end, {
        label: `mts-core:${sourceIndex}:${linkEvents[sourceIndex].length}`,
        tags: ["mts-core-accepted-step"],
      });
      linkEvents[sourceIndex].push({
        start,
        end,
        ref: ensured.ref,
        created: ensured.created,
      });
      return ensured.ref;
    },
  };

  function* instrumentedAbits() {
    for (let index = 0; index < artifact.symbols.length; index += 1) {
      sourceIndex = index;
      yield artifact.symbols[index];
      visibleAfter[index] = builder.aset.links.map((link) => link.id);
    }
  }

  let upstream;
  try {
    upstream = executeAbits(instrumentedAbits(), algebra);
  } catch (error) {
    if (error?.code === "unexpected-close" || error?.code === "unclosed-open") {
      const index = error.code === "unexpected-close"
        ? sourceIndex
        : lastUnclosedOpen(artifact.symbols);
      const token = error.code === "unexpected-close" ? "]" : "[";
      throw transitionError(error.code, index, token, error.message);
    }
    throw error;
  }

  const { trace, frames } = projectAcceptedTrace(
    artifact,
    refs,
    upstream.operations,
    linkEvents,
    initialVisibleLinkIds,
    visibleAfter,
  );
  const rootFrame = frames[0];
  const projectedResult = rootFrame.started ? rootFrame.current : "R";
  if (projectedResult !== upstream.denotation) {
    throw new Error(`accepted trace projection diverged from @mts/core: ${projectedResult} != ${upstream.denotation}`);
  }

  const resultSequence = builder.addLinkSequence(rootFrame.values, { role: "top-level-values" });
  finish(builder, artifact, {
    algorithm: "anum-v0.4",
    status: "accepted",
    sourceSequence,
    abitSequence,
    linkSequence: physicalLinks,
    resultSequence,
    carrier: carrier.head,
    denotation: upstream.denotation,
    semanticAuthority: {
      kind: "exact-generated-package",
      package: MTS_CORE_PROVENANCE.package,
      version: MTS_CORE_PROVENANCE.packageVersion,
      contract: MTS_CORE_PROVENANCE.contract,
      conformance: MTS_CORE_PROVENANCE.conformance,
      upstreamRepository: MTS_CORE_PROVENANCE.repository,
      upstreamCommit: MTS_CORE_PROVENANCE.commit,
      artifactSha256: MTS_CORE_PROVENANCE.artifactSha256,
      generatedTreeSha256: MTS_CORE_PROVENANCE.treeSha256,
      consumerLock: "anum-parser-mts-core-consumer-lock/v0.1",
    },
  });
  maybeStore(builder, carrier.head, upstream.denotation, options);
  trace.push(projectedSnapshot(
    trace.length,
    artifact.symbols.length,
    "",
    null,
    "finish",
    frames,
    [],
    [],
    builder.aset.links.map((link) => link.id),
    `Результат accepted @mts/core: ${upstream.denotation}`,
  ));
  return { aset: builder.finish(), trace, result: upstream.denotation, carrier: carrier.head };
}

function projectAcceptedTrace(artifact, refs, operations, linkEvents, initialVisibleLinkIds, visibleAfter) {
  if (operations.length !== artifact.symbols.length) {
    throw new Error("@mts/core operation count does not match validated abit sequence");
  }
  const trace = [];
  const frames = [newFrame(null)];
  trace.push(projectedSnapshot(
    0,
    -1,
    "",
    null,
    "start",
    frames,
    [],
    [],
    initialVisibleLinkIds,
    "Source и carrier загружены; accepted @mts/core execution ещё не начато",
  ));

  for (let index = 0; index < artifact.symbols.length; index += 1) {
    const token = artifact.symbols[index];
    const ref = refs[index];
    const events = linkEvents[index];
    let eventIndex = 0;
    const produced = [];
    const reused = [];

    const consume = (start, end) => {
      const event = events[eventIndex];
      eventIndex += 1;
      if (!event) throw new Error(`missing @mts/core link event at source index ${index}`);
      if (event.start !== start || event.end !== end) {
        throw new Error(`unexpected @mts/core link event at ${index}: ${event.start}->${event.end}, expected ${start}->${end}`);
      }
      const target = event.created ? produced : reused;
      if (!target.includes(event.ref)) target.push(event.ref);
      return event.ref;
    };

    if (token === "[") {
      if (operations[index] !== "OPEN") throw new Error(`expected OPEN at ${index}`);
      frames.push(newFrame(index));
      assertEventsConsumed(events, eventIndex, index);
      trace.push(projectedSnapshot(trace.length, index, token, ref, "open", frames, produced, reused,
        visibleAfter[index], "@mts/core открыл новый контекст от R"));
      continue;
    }

    if (token === "]") {
      if (operations[index] !== "CLOSE") throw new Error(`expected CLOSE at ${index}`);
      if (frames.length === 1) throw new Error("trace projection received impossible close");
      const inner = frames.pop();
      let returned = inner.started ? inner.current : "R";
      if (inner.started) returned = consume("R", returned);
      appendProjected(frames.at(-1), returned, consume);
      assertEventsConsumed(events, eventIndex, index);
      trace.push(projectedSnapshot(trace.length, index, token, ref, "close:mts-core", frames, produced, reused,
        visibleAfter[index], `@mts/core вернул из группы ${returned}`));
      continue;
    }

    if (operations[index] !== "VALUE") throw new Error(`expected VALUE at ${index}`);
    appendProjected(frames.at(-1), ref, consume);
    assertEventsConsumed(events, eventIndex, index);
    trace.push(projectedSnapshot(trace.length, index, token, ref, "value", frames, produced, reused,
      visibleAfter[index], `@mts/core принял связь-абит ${ref}`));
  }

  return { trace, frames };
}

function appendProjected(frame, value, consume) {
  frame.values.push(value);
  if (!frame.started) {
    frame.current = value;
    frame.started = true;
    return;
  }
  frame.current = consume(frame.current, value);
}

function assertEventsConsumed(events, eventIndex, sourceIndex) {
  if (eventIndex !== events.length) {
    throw new Error(`unconsumed @mts/core link events at source index ${sourceIndex}`);
  }
}

function projectedSnapshot(stepIndex, sourceIndex, token, resolved, operation, frames, producedLinks, reusedLinks, visibleLinkIds, note) {
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
    visibleLinkIds: [...visibleLinkIds],
    note,
  };
}

function lastUnclosedOpen(symbols) {
  const stack = [];
  for (let index = 0; index < symbols.length; index += 1) {
    if (symbols[index] === "[") stack.push(index);
    if (symbols[index] === "]" && stack.length) stack.pop();
  }
  return stack.at(-1) ?? -1;
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
  if (options.status === "accepted") {
    throw new Error("local deserializeStack is experimental-only; accepted execution must use @mts/core");
  }
  const { builder, refs, sourceSequence, abitSequence } = prepareAbits(artifact);
  const physicalLinks = builder.addLinkSequence(refs, { role: "physical-abit-values" });
  const carrier = builder.rootChain(refs, { sourceSequence: physicalLinks });
  const trace = [];
  const frames = [newFrame(null)];

  trace.push(snapshot(builder, trace.length, -1, "", null, "start", frames, [], [],
    "Исходная запись и её carrier загружены; experimental execution ещё не начато"));

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
      const returned = inner.started ? inner.current : "R";
      const produced = [];
      const reused = [];
      appendValue(builder, frames.at(-1), returned, produced, reused, `close:${index}`);
      trace.push(snapshot(builder, trace.length, index, token, ref, `close:${options.closeStrategy}`,
        frames, produced, reused, `Experimental группа вернула ${returned}`));
      continue;
    }

    const produced = [];
    const reused = [];
    appendValue(builder, frames.at(-1), ref, produced, reused, `value:${index}`);
    trace.push(snapshot(builder, trace.length, index, token, ref, "value", frames, produced, reused,
      `Добавить связь-абит ${ref} в experimental контекст`));
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
    `Experimental результат верхнего контекста: ${result}`));
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
    ...(data.semanticAuthority ? { semanticAuthority: data.semanticAuthority } : {}),
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
