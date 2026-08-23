import { normalizeVisualLinkNetwork } from "../generated/mts-visual/index.js";

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
