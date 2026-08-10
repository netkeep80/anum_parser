export function renderAset(svg, aset) {
  svg.replaceChildren();
  if (!aset?.links?.length) return;

  const width = Math.max(760, svg.clientWidth || 760);
  const height = 520;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const defs = element("defs");
  const marker = element("marker", {
    id: "arrow",
    markerWidth: "8",
    markerHeight: "8",
    refX: "7",
    refY: "4",
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  marker.append(element("path", { d: "M0,0 L8,4 L0,8 z", class: "graph-arrow" }));
  defs.append(marker);
  svg.append(defs);

  const links = aset.links.slice(0, 80);
  const positions = layout(links, aset.root, width, height);

  const edgeLayer = element("g", { class: "graph-edges" });
  const nodeLayer = element("g", { class: "graph-nodes" });
  svg.append(edgeLayer, nodeLayer);

  for (const link of links) {
    const from = positions.get(link.id);
    drawPole(edgeLayer, positions, from, link.start, "start");
    drawPole(edgeLayer, positions, from, link.end, "end");
  }

  for (const link of links) {
    const pos = positions.get(link.id);
    const group = element("g", {
      class: `graph-node ${link.id === aset.root ? "root" : ""}`,
      transform: `translate(${pos.x},${pos.y})`,
      tabindex: "0",
    });
    const label = aset.labels?.[link.id] ?? link.id;
    group.append(
      element("circle", { r: link.id === aset.root ? "25" : "19" }),
      textElement("text", link.id, { y: "4", "text-anchor": "middle", class: "graph-id" }),
      textElement("text", label, { y: "38", "text-anchor": "middle", class: "graph-label" }),
      textElement("title", `${link.id}: ${link.start} ⟼ ${link.end}${label ? `\n${label}` : ""}`),
    );
    nodeLayer.append(group);
  }

  if (aset.links.length > links.length) {
    svg.append(
      textElement("text", `Показаны первые ${links.length} из ${aset.links.length} связей`, {
        x: "14",
        y: String(height - 14),
        class: "graph-limit",
      }),
    );
  }
}

function layout(links, rootId, width, height) {
  const result = new Map();
  const center = { x: width / 2, y: height / 2 };
  result.set(rootId, center);
  const rest = links.filter((link) => link.id !== rootId);
  const rings = Math.max(1, Math.ceil(rest.length / 18));
  rest.forEach((link, index) => {
    const ring = Math.floor(index / 18);
    const ringItems = Math.min(18, rest.length - ring * 18);
    const local = index % 18;
    const radius = 105 + ring * Math.min(105, 280 / rings);
    const angle = -Math.PI / 2 + (local / ringItems) * Math.PI * 2 + ring * 0.22;
    result.set(link.id, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  });
  return result;
}

function drawPole(layer, positions, from, targetId, role) {
  const to = positions.get(targetId);
  if (!from || !to) return;
  if (from === to) {
    layer.append(
      element("path", {
        d: `M ${from.x - 12} ${from.y - 16} C ${from.x - 58} ${from.y - 72}, ${from.x + 58} ${from.y - 72}, ${from.x + 12} ${from.y - 16}`,
        class: `graph-edge ${role}`,
        "marker-end": "url(#arrow)",
      }),
    );
    return;
  }
  layer.append(
    element("line", {
      x1: String(from.x),
      y1: String(from.y),
      x2: String(to.x),
      y2: String(to.y),
      class: `graph-edge ${role}`,
      "marker-end": "url(#arrow)",
    }),
  );
}

function element(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function textElement(name, text, attrs = {}) {
  const node = element(name, attrs);
  node.textContent = text;
  return node;
}
