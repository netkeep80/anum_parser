import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeVisualLinkNetwork,
  validateVisualLinkNetwork,
} from "../generated/mts-visual/index.js";
import { projectAsetToVisualLinkNetwork } from "../src/mts-visual-adapter.js";

const EXPECTED_VISUAL_COMMIT = "aca8984ba94b4ecd33de3a003a4bba3eb5fce56f";
const EXPECTED_CORE_COMMIT = "6b7f616c7b275310aebdbe998da13c5811c91391";

function kernelAset(extraLinks = [], labels = {}, extra = {}) {
  return {
    format: "mts-aset",
    version: "0.2",
    identity: "by-poles",
    root: "R",
    links: [
      { id: "R", start: "R", end: "R", tags: ["root"] },
      { id: "O", start: "O", end: "R", tags: ["root-abit", "opening"] },
      { id: "C", start: "R", end: "C", tags: ["root-abit", "closing"] },
      { id: "L", start: "O", end: "C", tags: ["root-abit", "linked"] },
      { id: "U", start: "C", end: "O", tags: ["root-abit", "unlinked"] },
      ...extraLinks,
    ],
    labels: { R: "∞", O: "[", C: "]", L: "1", U: "0", ...labels },
    provenance: {
      deserializer: "test-only",
      source: { kind: "anum", raw: "[]" },
      debug: { current: "L" },
    },
    ...extra,
  };
}

function topology(network) {
  return normalizeVisualLinkNetwork(network).links.map(({ key, startKey, endKey }) => ({
    key,
    startKey,
    endKey,
  }));
}

test("visual presentation dependency is exact and independent from semantic core", () => {
  const visualLock = JSON.parse(readFileSync("contracts/mts-visual-consumer-lock.json", "utf8"));
  const coreLock = JSON.parse(readFileSync("contracts/mts-core-consumer-lock.json", "utf8"));
  const provenance = JSON.parse(readFileSync("generated/mts-visual-provenance.json", "utf8"));

  assert.equal(visualLock.schema, "anum-parser-mts-visual-consumer-lock/v0.1");
  assert.equal(visualLock.channel, "accepted-presentation");
  assert.equal(visualLock.repository, "netkeep80/anum_docs");
  assert.equal(visualLock.commit, EXPECTED_VISUAL_COMMIT);
  assert.equal(visualLock.package.name, "@mts/visual");
  assert.equal(visualLock.package.version, "0.1.0");
  assert.equal(visualLock.package.root, "packages/visual");
  assert.equal(visualLock.package.dependencies.three, "0.185.1");
  assert.equal(visualLock.authority.floatingRefAllowed, false);
  assert.equal(visualLock.authority.deepSourceImportAllowed, false);

  assert.equal(coreLock.schema, "anum-parser-mts-core-consumer-lock/v0.1");
  assert.equal(coreLock.commit, EXPECTED_CORE_COMMIT);
  assert.equal(coreLock.package.name, "@mts/core");
  assert.equal(coreLock.accepted.contract.schema, "mts-contract/v0.11");

  assert.equal(provenance.repository, visualLock.repository);
  assert.equal(provenance.commit, visualLock.commit);
  assert.equal(provenance.package, visualLock.package.name);
  assert.equal(provenance.packageVersion, visualLock.package.version);
  assert.match(provenance.treeSha256, /^[0-9a-f]{64}$/);
});

test("materialized @mts/visual exposes public root and three entries", async () => {
  const root = await import("../generated/mts-visual/index.js");
  const three = await import("../generated/mts-visual/three/index.js");
  assert.equal(typeof root.normalizeVisualLinkNetwork, "function");
  assert.equal(typeof root.validateVisualLinkNetwork, "function");
  assert.equal(typeof root.createLivePhysics3D, "function");
  assert.equal(typeof three.createVisualThreeLiveRenderer, "function");
  assert.equal(typeof three.setVisualThreeLivePhysicsOptions, "function");
});

test("Aset adapter preserves exact kernel topology and presentation-only metadata", () => {
  const aset = kernelAset();
  const before = JSON.stringify(aset);
  const projected = projectAsetToVisualLinkNetwork(aset);
  validateVisualLinkNetwork(projected);

  assert.deepEqual(topology(projected), [
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "R", startKey: "R", endKey: "R" },
    { key: "U", startKey: "C", endKey: "O" },
  ]);
  assert.equal(projected.links.find((link) => link.key === "R")?.label, "∞");
  assert.deepEqual(projected.links.find((link) => link.key === "R")?.tags, ["root"]);
  assert.equal(JSON.stringify(aset), before, "adapter must not mutate semantic Aset input");
});

test("ordinary, self and link-of-links topology preserve start/end exactly", () => {
  const aset = kernelAset([
    { id: "X", start: "L", end: "U", tags: ["link-of-links"] },
    { id: "SS", start: "SS", end: "R" },
    { id: "ES", start: "R", end: "ES" },
    { id: "DS", start: "DS", end: "DS" },
  ]);
  const projected = projectAsetToVisualLinkNetwork(aset);
  const byKey = new Map(projected.links.map((link) => [link.key, link]));

  assert.deepEqual(
    [byKey.get("X")?.startKey, byKey.get("X")?.endKey],
    ["L", "U"],
    "link-of-links orientation must not swap",
  );
  assert.deepEqual([byKey.get("SS")?.startKey, byKey.get("SS")?.endKey], ["SS", "R"]);
  assert.deepEqual([byKey.get("ES")?.startKey, byKey.get("ES")?.endKey], ["R", "ES"]);
  assert.deepEqual([byKey.get("DS")?.startKey, byKey.get("DS")?.endKey], ["DS", "DS"]);
  validateVisualLinkNetwork(projected);
});

test("input order and parser-only provenance do not alter normalized shared topology", () => {
  const links = [
    { id: "X", start: "L", end: "U" },
    { id: "Y", start: "X", end: "R" },
  ];
  const a = kernelAset(links, { X: "display X", Y: "display Y" });
  const b = {
    ...kernelAset([...links].reverse(), { X: "other X", Y: "other Y" }),
    provenance: { deserializer: "other", source: { raw: "different" }, current: "Y" },
  };

  assert.deepEqual(
    topology(projectAsetToVisualLinkNetwork(a)),
    topology(projectAsetToVisualLinkNetwork(b)),
  );
});
