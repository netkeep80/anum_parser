import {
  normalizeVisualLinkNetwork,
  normalizeVisualPresentationState,
} from "../generated/mts-visual/index.js";

const HALOS = Object.freeze({
  current: Object.freeze({ color: 0xffd166, scale: 1.55, opacity: 0.32 }),
  selected: Object.freeze({ color: 0xffffff, scale: 1.55, opacity: 0.28 }),
  reused: Object.freeze({ color: 0x73a7ff, scale: 1.55, opacity: 0.22 }),
});

/**
 * Project one parser-owned Aset snapshot into the shared presentation topology.
 *
 * Aset ids are used only as VisualKey references for this snapshot. Parser
 * provenance/debug state and root status do not participate in shared identity.
 */
export function projectAsetToVisualLinkNetwork(aset) {
  const links = Array.isArray(aset?.links)
    ? aset.links.map((link) => ({
        key: link.id,
        startKey: link.start,
        endKey: link.end,
        ...(aset?.labels?.[link.id] === undefined ? {} : { label: aset.labels[link.id] }),
        ...(Array.isArray(link.tags) ? { tags: [...link.tags] } : {}),
      }))
    : [];

  return normalizeVisualLinkNetwork({ links });
}

/**
 * Project exactly the links that exist at one parser debugger step.
 *
 * `visibleLinkIds` is parser trace authority for current existence in the 3D
 * world. Endpoint links are never pulled in implicitly: malformed trace state
 * fails explicitly instead of allowing hidden future topology to leak in.
 * Without debugger state (for example an imported Aset), the full projection is
 * preserved.
 */
export function projectDebugStepVisualLinkNetwork(aset, debugState = null) {
  const full = projectAsetToVisualLinkNetwork(aset);
  if (debugState === null || typeof debugState !== "object") return full;
  if (!Array.isArray(debugState.visibleLinkIds)) {
    throw new Error("debug step visibleLinkIds must be an array");
  }

  const byKey = new Map(full.links.map((link) => [link.key, link]));
  const wanted = new Set(debugState.visibleLinkIds);

  for (const key of wanted) {
    if (!byKey.has(key)) {
      throw new Error(`debug step topology contains unknown VisualKey ${JSON.stringify(key)}`);
    }
  }

  const currentLinks = full.links.filter((link) => wanted.has(link.key));
  for (const link of currentLinks) {
    if (!wanted.has(link.startKey)) {
      throw new Error(
        `debug step topology is not reference-closed: ${link.key}.startKey -> ${link.startKey}`,
      );
    }
    if (!wanted.has(link.endKey)) {
      throw new Error(
        `debug step topology is not reference-closed: ${link.key}.endKey -> ${link.endKey}`,
      );
    }
  }

  return normalizeVisualLinkNetwork({ links: currentLinks });
}

/**
 * Convert parser-only debugger/selection roles into the generic presentation
 * vocabulary owned by @mts/visual. Unknown parser ids are deliberately ignored.
 */
export function projectParserVisualPresentation(network, debugState = null, selectedKey = null) {
  const normalized = normalizeVisualLinkNetwork(network);
  const keys = normalized.links.map((link) => link.key);
  const known = new Set(keys);
  const hasDebugState = debugState !== null && typeof debugState === "object";
  const visible = hasDebugState
    ? new Set((debugState.visibleLinkIds ?? []).filter((key) => known.has(key)))
    : new Set(keys);
  const produced = new Set((debugState?.producedLinks ?? []).filter((key) => known.has(key)));
  const reused = new Set((debugState?.reusedLinks ?? []).filter((key) => known.has(key)));
  const current = known.has(debugState?.current) ? debugState.current : null;
  const selected = known.has(selectedKey) ? selectedKey : null;

  const links = normalized.links.map(({ key }) => {
    const isCurrent = current === key;
    const isSelected = selected === key;
    const isProduced = produced.has(key);
    const isReused = reused.has(key);
    const entry = {
      key,
      visible: visible.has(key),
      ...(isSelected ? { selected: true } : {}),
    };

    if (isCurrent) entry.emphasis = 1.35;
    else if (isSelected) entry.emphasis = 1.25;
    else if (isProduced) entry.emphasis = 1.16;

    if (isCurrent) entry.halo = HALOS.current;
    else if (isSelected) entry.halo = HALOS.selected;
    else if (isReused) entry.halo = HALOS.reused;

    if (isCurrent || isSelected) entry.labelVisible = true;
    return entry;
  });

  return normalizeVisualPresentationState(normalized, { links });
}
