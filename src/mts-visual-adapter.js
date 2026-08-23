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

function immutableReadablePoint(raw, key) {
  if (raw === null || raw === undefined) {
    throw new Error(`Missing readable position for VisualKey ${key}`);
  }
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.z)) {
    throw new Error(`Non-finite readable position for VisualKey ${key}`);
  }
  return Object.freeze({ x: raw.x, y: raw.y, z: raw.z });
}

/**
 * Temporary P2b bridge: the parser-readable layout is consumed once as an
 * initial position seed. The returned shared Physics3DState contains no pin or
 * root metadata; all subsequent motion belongs to @mts/visual V2d/V2e.
 *
 * Delete this bridge in P3 when a consumer-neutral initial-layout strategy is
 * accepted upstream, or when the parser no longer needs the historical seed.
 */
export function projectReadableLayoutToPhysics3DState(network, readableState) {
  const normalized = normalizeVisualLinkNetwork(network);
  const readablePositions = readableState?.positions ?? {};
  const positions = normalized.links.map(({ key }) => Object.freeze({
    key,
    point: immutableReadablePoint(readablePositions[key], key),
  }));
  const velocities = normalized.links.map(({ key }) => Object.freeze({
    key,
    vector: Object.freeze({ x: 0, y: 0, z: 0 }),
  }));

  return Object.freeze({
    positions: Object.freeze(positions),
    velocities: Object.freeze(velocities),
  });
}
