export const FORMAT_VERSION = "0.1";

export class AsetBuilder {
  constructor({ source = null } = {}) {
    this.counter = 0;
    this.aset = {
      format: "mts-aset",
      version: FORMAT_VERSION,
      root: "R",
      links: [{ id: "R", start: "R", end: "R", tags: ["root"] }],
      labels: { R: "∞" },
      symbolSequences: [],
      abitSequences: [],
      linkSequences: [],
      rootChains: [],
      storedAnums: [],
      provenance: source ? { source } : {},
    };
    this.ids = new Set(["R"]);
  }

  nextId(prefix = "L") {
    let id;
    do {
      this.counter += 1;
      id = `${prefix}${this.counter}`;
    } while (this.ids.has(id));
    return id;
  }

  link(start, end, { id = null, label = null, tags = [] } = {}) {
    if (!this.ids.has(start) || !this.ids.has(end)) {
      throw new Error(`link endpoints must exist: ${start} -> ${end}`);
    }
    const ref = id ?? this.nextId("L");
    if (this.ids.has(ref)) {
      throw new Error(`duplicate exact link id: ${ref}`);
    }
    this.ids.add(ref);
    this.aset.links.push({ id: ref, start, end, ...(tags.length ? { tags } : {}) });
    if (label !== null) this.aset.labels[ref] = label;
    return ref;
  }

  occurrence(label, tag = "symbol-occurrence") {
    // Лабораторный exact handle: полюса могут совпадать с R, но occurrence
    // отличается exact id. Это не нормативное определение символов МТС.
    return this.link("R", "R", { label, tags: [tag] });
  }

  leftFold(refs, { tag = "denotation-step", labelPrefix = "fold" } = {}) {
    if (refs.length === 0) return { result: "R", created: [] };
    if (refs.length === 1) return { result: refs[0], created: [] };
    const created = [];
    let current = refs[0];
    for (let i = 1; i < refs.length; i += 1) {
      current = this.link(current, refs[i], {
        label: `${labelPrefix}:${i}`,
        tags: [tag],
      });
      created.push(current);
    }
    return { result: current, created };
  }

  rootChain(refs, { id = null, sourceSequence = null, tag = "root-chain-step" } = {}) {
    const created = [];
    let current = "R";
    for (const ref of refs) {
      current = this.link(current, ref, { tags: [tag] });
      created.push(current);
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
}

export function validateAset(aset) {
  const errors = [];
  if (!aset || aset.format !== "mts-aset") errors.push("format must be mts-aset");
  if (aset?.version !== FORMAT_VERSION) errors.push(`unsupported aset version: ${aset?.version}`);
  if (!Array.isArray(aset?.links)) errors.push("links must be an array");
  if (errors.length) return errors;

  const ids = new Set();
  for (const link of aset.links) {
    if (!link?.id || ids.has(link.id)) {
      errors.push(`duplicate or empty link id: ${link?.id}`);
      continue;
    }
    ids.add(link.id);
  }
  if (!ids.has(aset.root)) errors.push("missing distinguished root link");
  for (const link of aset.links) {
    if (!ids.has(link.start)) errors.push(`dangling start ref ${link.start} in ${link.id}`);
    if (!ids.has(link.end)) errors.push(`dangling end ref ${link.end} in ${link.id}`);
  }
  const root = aset.links.find((link) => link.id === aset.root);
  if (root && (root.start !== root.id || root.end !== root.id)) {
    errors.push("distinguished root must be exactly self-closed in format 0.1");
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
