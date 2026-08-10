export const FORMAT_VERSION = "0.2";

const ROOT_LINKS = Object.freeze([
  { id: "R", start: "R", end: "R", tags: ["root"] },
  { id: "O", start: "O", end: "R", tags: ["root-abit", "opening"] },
  { id: "C", start: "R", end: "C", tags: ["root-abit", "closing"] },
  { id: "L", start: "O", end: "C", tags: ["root-abit", "linked"] },
  { id: "U", start: "C", end: "O", tags: ["root-abit", "unlinked"] },
]);

const ROOT_LABELS = Object.freeze({ R: "∞", O: "[", C: "]", L: "1", U: "0" });

export const ABIT_REFS = Object.freeze({ "[": "O", "]": "C", "1": "L", "0": "U" });

export class AsetBuilder {
  constructor({ source = null } = {}) {
    this.counter = 0;
    this.aset = {
      format: "mts-aset",
      version: FORMAT_VERSION,
      identity: "by-poles",
      root: "R",
      links: ROOT_LINKS.map((link) => structuredClone(link)),
      labels: { ...ROOT_LABELS },
      symbolSequences: [],
      abitSequences: [],
      linkSequences: [],
      rootChains: [],
      storedAnums: [],
      provenance: source ? { source } : {},
    };
    this.ids = new Set(ROOT_LINKS.map((link) => link.id));
    this.pairs = new Map(ROOT_LINKS.map((link) => [pairKey(link.start, link.end), link.id]));
  }

  nextId(prefix = "L") {
    let id;
    do {
      this.counter += 1;
      id = `${prefix}${this.counter}`;
    } while (this.ids.has(id));
    return id;
  }

  ensureLink(start, end, { id = null, label = null, tags = [] } = {}) {
    if (!this.ids.has(start) || !this.ids.has(end)) {
      throw new Error(`link endpoints must exist: ${start} -> ${end}`);
    }

    const key = pairKey(start, end);
    const existing = this.pairs.get(key);
    if (existing) {
      if (id !== null && id !== existing) {
        throw new Error(`link ${start} -> ${end} already exists as ${existing}, cannot alias it as ${id}`);
      }
      this.mergeMetadata(existing, label, tags);
      return { ref: existing, created: false };
    }

    const ref = id ?? this.nextId("L");
    if (this.ids.has(ref)) {
      throw new Error(`duplicate link id: ${ref}`);
    }
    this.ids.add(ref);
    this.pairs.set(key, ref);
    this.aset.links.push({ id: ref, start, end, ...(tags.length ? { tags: [...new Set(tags)] } : {}) });
    if (label !== null) this.aset.labels[ref] = label;
    return { ref, created: true };
  }

  link(start, end, options = {}) {
    return this.ensureLink(start, end, options).ref;
  }

  symbolValue(symbol) {
    const bytes = new TextEncoder().encode(symbol);
    if (bytes.length === 0) throw new Error("empty symbol cannot be resolved as one value");
    let current = "R";
    for (const byte of bytes) {
      for (let bit = 7; bit >= 0; bit -= 1) {
        const ref = ((byte >> bit) & 1) === 1 ? "L" : "U";
        current = this.link(current, ref, { tags: ["utf8-symbol-code-step"] });
      }
    }
    this.mergeMetadata(current, `symbol:${JSON.stringify(symbol)}`, ["utf8-symbol-value"]);
    return current;
  }

  leftFold(refs, { tag = "denotation-step", labelPrefix = "fold" } = {}) {
    if (refs.length === 0) return { result: "R", created: [] };
    if (refs.length === 1) return { result: refs[0], created: [] };
    const created = [];
    let current = refs[0];
    for (let i = 1; i < refs.length; i += 1) {
      const ensured = this.ensureLink(current, refs[i], {
        label: `${labelPrefix}:${i}`,
        tags: [tag],
      });
      current = ensured.ref;
      if (ensured.created) created.push(current);
    }
    return { result: current, created };
  }

  rootChain(refs, { id = null, sourceSequence = null, tag = "root-chain-step" } = {}) {
    const created = [];
    let current = "R";
    for (const ref of refs) {
      const ensured = this.ensureLink(current, ref, { tags: [tag] });
      current = ensured.ref;
      if (ensured.created) created.push(current);
    }
    const chainId = id ?? `carrier:${this.aset.rootChains.length}`;
    this.aset.rootChains.push({
      id: chainId,
      ...(sourceSequence ? { sourceSequence } : {}),
      items: [...refs],
      head: current,
      created: [...created],
    });
    return { id: chainId, head: current, created };
  }

  addSymbolSequence(text, items, { id = null, kind = "utf8-symbols" } = {}) {
    const sequenceId = id ?? `source:${this.aset.symbolSequences.length}`;
    this.aset.symbolSequences.push({ id: sequenceId, kind, text, items: [...items] });
    return sequenceId;
  }

  addAbitSequence(symbols, refs, { id = null, profile = "mts-abit-v1" } = {}) {
    const sequenceId = id ?? `abits:${this.aset.abitSequences.length}`;
    this.aset.abitSequences.push({
      id: sequenceId,
      profile,
      symbols: [...symbols],
      refs: [...refs],
    });
    return sequenceId;
  }

  addLinkSequence(items, { id = null, role = "resolved-values" } = {}) {
    const sequenceId = id ?? `links:${this.aset.linkSequences.length}`;
    this.aset.linkSequences.push({ id: sequenceId, role, items: [...items] });
    return sequenceId;
  }

  storeAnum(carrier, denotation, { serializer = "storage-link-v0", status = "experimental" } = {}) {
    const storageLink = this.link(carrier, denotation, {
      label: `[anum:${this.aset.storedAnums.length}]`,
      tags: ["stored-anum-link", status],
    });
    const id = `stored:${this.aset.storedAnums.length}`;
    this.aset.storedAnums.push({
      id,
      storageLink,
      carrier,
      denotation,
      serializer,
      status,
    });
    return storageLink;
  }

  setProvenance(extra) {
    this.aset.provenance = { ...this.aset.provenance, ...extra };
  }

  finish() {
    return structuredClone(this.aset);
  }

  mergeMetadata(ref, label, tags) {
    if (label !== null && this.aset.labels[ref] === undefined) this.aset.labels[ref] = label;
    if (!tags.length) return;
    const link = this.aset.links.find((item) => item.id === ref);
    if (!link) return;
    link.tags = [...new Set([...(link.tags ?? []), ...tags])];
  }
}

export function validateAset(aset) {
  const errors = [];
  if (!aset || aset.format !== "mts-aset") errors.push("format must be mts-aset");
  if (aset?.version !== FORMAT_VERSION) errors.push(`unsupported aset version: ${aset?.version}`);
  if (aset?.identity !== "by-poles") errors.push("identity must be by-poles");
  if (!Array.isArray(aset?.links)) errors.push("links must be an array");
  if (errors.length) return errors;

  const ids = new Set();
  const pairs = new Map();
  for (const link of aset.links) {
    if (!link?.id || ids.has(link.id)) {
      errors.push(`duplicate or empty link id: ${link?.id}`);
      continue;
    }
    ids.add(link.id);
    const key = pairKey(link.start, link.end);
    const prior = pairs.get(key);
    if (prior) errors.push(`duplicate link form ${link.start} -> ${link.end}: ${prior}, ${link.id}`);
    else pairs.set(key, link.id);
  }

  if (aset.root !== "R") errors.push("format 0.2 requires distinguished root id R");
  for (const link of aset.links) {
    if (!ids.has(link.start)) errors.push(`dangling start ref ${link.start} in ${link.id}`);
    if (!ids.has(link.end)) errors.push(`dangling end ref ${link.end} in ${link.id}`);
  }

  const kernel = new Map(ROOT_LINKS.map((link) => [link.id, link]));
  for (const [id, expected] of kernel) {
    const actual = aset.links.find((link) => link.id === id);
    if (!actual) {
      errors.push(`missing root-kernel link ${id}`);
      continue;
    }
    if (actual.start !== expected.start || actual.end !== expected.end) {
      errors.push(`invalid root-kernel form ${id}: expected ${expected.start} -> ${expected.end}`);
    }
  }
  return errors;
}

export function linkMap(aset) {
  return new Map(aset.links.map((link) => [link.id, link]));
}

export function describeLink(aset, id) {
  const map = linkMap(aset);
  const link = map.get(id);
  if (!link) return id;
  const label = aset.labels?.[id];
  return label ? `${id} «${label}»` : `${id} = ${link.start} ⟼ ${link.end}`;
}

function pairKey(start, end) {
  return JSON.stringify([start, end]);
}
