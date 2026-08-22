const DEFAULT_VISUAL_LIMIT = 300;

export const SEMANTIC_COLORS = Object.freeze({
  start: "#ff657a",
  center: "#67e8b3",
  end: "#73a7ff",
});

export const SEMANTIC_STYLE = Object.freeze({
  colors: SEMANTIC_COLORS,
  startArc: Object.freeze({
    colorFrom: SEMANTIC_COLORS.start,
    colorTo: SEMANTIC_COLORS.center,
    arrow: "none",
  }),
  endArc: Object.freeze({
    colorFrom: SEMANTIC_COLORS.center,
    colorTo: SEMANTIC_COLORS.end,
    arrow: "target",
  }),
});

export function buildVisualModel(aset, limit = DEFAULT_VISUAL_LIMIT) {
  const links = Array.isArray(aset?.links)
    ? aset.links.slice(0, normalizeLimit(limit))
    : [];
  const visibleIds = new Set(links.map((link) => link.id));
  const nodes = links.map((link) => ({
    id: link.id,
    linkId: link.id,
    label: visualLabel(aset, link.id),
    root: link.id === aset?.root,
    startId: link.start,
    endId: link.end,
    semanticColor: SEMANTIC_COLORS.center,
  }));
  const arcs = [];

  for (const link of links) {
    if (visibleIds.has(link.start)) {
      arcs.push({
        id: `pole-start:${link.id}`,
        linkId: link.id,
        role: "start",
        poleId: link.start,
        semanticSource: link.start,
        semanticTarget: link.id,
        colorFrom: SEMANTIC_STYLE.startArc.colorFrom,
        colorTo: SEMANTIC_STYLE.startArc.colorTo,
        arrow: SEMANTIC_STYLE.startArc.arrow,
      });
    }
    if (visibleIds.has(link.end)) {
      arcs.push({
        id: `pole-end:${link.id}`,
        linkId: link.id,
        role: "end",
        poleId: link.end,
        semanticSource: link.id,
        semanticTarget: link.end,
        colorFrom: SEMANTIC_STYLE.endArc.colorFrom,
        colorTo: SEMANTIC_STYLE.endArc.colorTo,
        arrow: SEMANTIC_STYLE.endArc.arrow,
      });
    }
  }

  return {
    rootId: visibleIds.has(aset?.root) ? aset.root : null,
    nodes,
    arcs,
    semanticStyle: SEMANTIC_STYLE,
  };
}

export function normalizeVisualDebugState(visualModel, debugState = null) {
  const orderedIds = visualModel?.nodes?.map((node) => node.linkId) ?? [];
  const knownIds = new Set(orderedIds);
  const requestedVisible = debugState
    ? new Set(debugState.visibleLinkIds ?? [])
    : knownIds;
  const requestedProduced = new Set(debugState?.producedLinks ?? []);
  const requestedReused = new Set(debugState?.reusedLinks ?? []);

  return {
    visibleLinkIds: orderedIds.filter((id) => requestedVisible.has(id)),
    producedLinks: orderedIds.filter((id) => requestedProduced.has(id)),
    reusedLinks: orderedIds.filter((id) => requestedReused.has(id)),
    current: debugState?.current ?? null,
  };
}

export function visualDebugFlags(debugState, linkId) {
  const visible = new Set(debugState?.visibleLinkIds ?? []);
  const produced = new Set(debugState?.producedLinks ?? []);
  const reused = new Set(debugState?.reusedLinks ?? []);
  return {
    visible: visible.has(linkId),
    produced: produced.has(linkId),
    reused: reused.has(linkId),
    current: debugState?.current === linkId,
  };
}

function visualLabel(aset, linkId) {
  const semanticLabel = aset?.labels?.[linkId];
  return semanticLabel && semanticLabel !== linkId
    ? `${linkId}\n${semanticLabel}`
    : linkId;
}

function normalizeLimit(limit) {
  if (!Number.isFinite(limit)) return DEFAULT_VISUAL_LIMIT;
  return Math.max(0, Math.floor(limit));
}
