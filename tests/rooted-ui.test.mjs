import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { GRAPH_LAYOUTS, ROOTED_LAYOUT_ID } from "../src/visualizer.js";

test("layout от акорня является основным режимом, а старые layout остаются доступны", async () => {
  assert.equal(ROOTED_LAYOUT_ID, "rooted");
  assert.equal(GRAPH_LAYOUTS[0].id, ROOTED_LAYOUT_ID);
  assert.equal(GRAPH_LAYOUTS[0].title, "От акорня");

  const ids = GRAPH_LAYOUTS.map((layout) => layout.id);
  for (const legacy of ["cose", "breadthfirst", "circle", "grid", "concentric"]) {
    assert.ok(ids.includes(legacy), `вспомогательный layout ${legacy} должен остаться доступным`);
  }

  const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(appSource, /ui\.graphLayout\.value\s*=\s*ROOTED_LAYOUT_ID/);
  assert.doesNotMatch(appSource, /ui\.graphLayout\.value\s*=\s*["']cose["']/);
});
