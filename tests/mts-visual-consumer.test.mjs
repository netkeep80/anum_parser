import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeVisualLinkNetwork,
  validateVisualLinkNetwork,
  validateVisualPresentationState,
} from "../generated/mts-visual/index.js";
import {
  projectAsetToVisualLinkNetwork,
  projectParserVisualPresentation,
} from "../src/mts-visual-adapter.js";

const EXPECTED_VISUAL_REPOSITORY = "netkeep80/mts_visual";
const EXPECTED_VISUAL_COMMIT = "2d76cd29143fa764f4a08d0c0a788ff73c38841c";
const EXPECTED_VISUAL_VERSION = "0.2.0";
const EXPECTED_VISUAL_ROOT = ".";
const EXPECTED_VISUAL_MANIFEST_BLOB = "f17a2e119cd1e98110b5a36baa8535a435a03ac1";
const EXPECTED_VISUAL_LOCKFILE_BLOB = "3446bedebbd0bbc00b676f97050083d17f02107b";
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

test("visual presentation dependency is exact standalone and independent from semantic core", () => {
  const visualLock = JSON.parse(readFileSync("contracts/mts-visual-consumer-lock.json", "utf8"));
  const coreLock = JSON.parse(readFileSync("contracts/mts-core-consumer-lock.json", "utf8"));
  const provenance = JSON.parse(readFileSync("generated/mts-visual-provenance.json", "utf8"));

  assert.equal(visualLock.schema, "anum-parser-mts-visual-consumer-lock/v0.1");
  assert.equal(visualLock.channel, "accepted-presentation");
  assert.equal(visualLock.repository, EXPECTED_VISUAL_REPOSITORY);
  assert.equal(visualLock.commit, EXPECTED_VISUAL_COMMIT);
  assert.equal(visualLock.package.name, "@mts/visual");
  assert.equal(visualLock.package.version, EXPECTED_VISUAL_VERSION);
  assert.equal(visualLock.package.root, EXPECTED_VISUAL_ROOT);
  assert.equal(visualLock.package.manifest.path, "package.json");
  assert.equal(visualLock.package.manifest.gitBlobSha, EXPECTED_VISUAL_MANIFEST_BLOB);
  assert.equal(visualLock.package.lockfile.path, "package-lock.json");
  assert.equal(visualLock.package.lockfile.gitBlobSha, EXPECTED_VISUAL_LOCKFILE_BLOB);
  assert.equal(visualLock.package.dependencies.three, "0.185.1");
  assert.equal(visualLock.authority.floatingRefAllowed, false);
  assert.equal(visualLock.authority.deepSourceImportAllowed, false);
  assert.equal(visualLock.authority.semanticAcceptanceClaimed, false);
  assert.equal(visualLock.authority.semanticCoreLockIndependent, true);

  assert.equal(coreLock.schema, "anum-parser-mts-core-consumer-lock/v0.1");
  assert.equal(coreLock.commit, EXPECTED_CORE_COMMIT);
  assert.equal(coreLock.package.name, "@mts/core");
  assert.equal(coreLock.accepted.contract.schema, "mts-contract/v0.11");

  assert.equal(provenance.repository, visualLock.repository);
  assert.equal(provenance.commit, visualLock.commit);
  assert.equal(provenance.package, visualLock.package.name);
  assert.equal(provenance.packageVersion, visualLock.package.version);
  assert.equal(provenance.manifestGitBlobSha, EXPECTED_VISUAL_MANIFEST_BLOB);
  assert.equal(provenance.lockfileGitBlobSha, EXPECTED_VISUAL_LOCKFILE_BLOB);
  assert.match(provenance.treeSha256, /^[0-9a-f]{64}$/);
});

test("materialized @mts/visual exposes accepted public root and three entries", async () => {
  const root = await import("../generated/mts-visual/index.js");
  const three = await import("../generated/mts-visual/three/index.js");
  assert.equal(typeof root.normalizeVisualLinkNetwork, "function");
  assert.equal(typeof root.validateVisualLinkNetwork, "function");
  assert.equal(typeof root.createInitialPhysics3DState, "function");
  assert.equal(typeof root.createLivePhysics3D, "function");
  assert.equal(typeof root.setLivePhysics3DOptions, "function");
  assert.equal(typeof root.snapshotLivePhysics3D, "function");
  assert.equal(typeof three.createVisualThreeLiveRenderer, "function");
  assert.equal(typeof three.setVisualThreeLivePaused, "function");
  assert.equal(typeof three.setVisualThreePresentation, "function");
  assert.equal(typeof three.getVisualThreeRendererSnapshot, "function");
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

test("parser debug roles map only into generic shared presentation fields", () => {
  const aset = kernelAset();
  const network = projectAsetToVisualLinkNetwork(aset);
  const beforeAset = JSON.stringify(aset);
  const beforeNetwork = JSON.stringify(network);
  const presentation = projectParserVisualPresentation(network, {
    visibleLinkIds: ["R", "L", "ghost"],
    producedLinks: ["L", "ghost"],
    reusedLinks: ["O", "ghost"],
    current: "R",
  }, "L");
  validateVisualPresentationState(network, presentation);
  const byKey = new Map(presentation.links.map((entry) => [entry.key, entry]));

  assert.deepEqual([...byKey.keys()], ["C", "L", "O", "R", "U"]);
  assert.deepEqual(byKey.get("R"), {
    key: "R",
    visible: true,
    emphasis: 1.35,
    labelVisible: true,
    halo: { color: 0xffd166, scale: 1.55, opacity: 0.32 },
  });
  assert.deepEqual(byKey.get("L"), {
    key: "L",
    visible: true,
    emphasis: 1.25,
    selected: true,
    labelVisible: true,
    halo: { color: 0xffffff, scale: 1.55, opacity: 0.28 },
  });
  assert.deepEqual(byKey.get("O"), {
    key: "O",
    visible: false,
    halo: { color: 0x73a7ff, scale: 1.55, opacity: 0.22 },
  });
  assert.deepEqual(byKey.get("C"), { key: "C", visible: false });
  assert.deepEqual(byKey.get("U"), { key: "U", visible: false });
  assert.equal(presentation.links.some((entry) => entry.key === "ghost"), false);
  assert.equal(JSON.stringify(aset), beforeAset);
  assert.equal(JSON.stringify(network), beforeNetwork);
});

test("production app delegates initial and live 3D authority to accepted standalone @mts/visual", () => {
  const source = readFileSync("src/app.js", "utf8");
  const adapter = readFileSync("src/mts-visual-adapter.js", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const materializer = readFileSync("scripts/materialize-mts-visual.mjs", "utf8");

  assert.match(
    source,
    /createInitialPhysics3DState[\s\S]*from\s+["']\.\.\/generated\/mts-visual\/index\.js["']/,
    "production app must import shared initial-state API from standalone root",
  );
  assert.match(
    source,
    /from\s+["']\.\.\/generated\/mts-visual\/three\/index\.js["']/,
    "production app must import standalone @mts/visual/three",
  );
  assert.doesNotMatch(source, /from\s+["']\.\/readable-layout3d\.js["']/);
  assert.doesNotMatch(source, /solveReadableLayout3d/);
  assert.doesNotMatch(source, /projectReadableLayoutToPhysics3DState/);
  assert.doesNotMatch(
    source,
    /physicalState/,
    "production app must not retain parser-local physical seed state",
  );
  assert.doesNotMatch(adapter, /projectReadableLayoutToPhysics3DState/);
  assert.doesNotMatch(
    materializer,
    /assert\.equal\(\s*lock\.package\.version\s*,\s*["']0\.1\.0["']\s*\)/,
    "visual materializer must follow the exact pinned lock version instead of historical 0.1.0",
  );
  assert.doesNotMatch(
    pkg.scripts.check,
    /src\/(?:geometry3d|physics3d|readability3d|readable-layout3d)\.js/,
    "syntax check must not reference deleted local seed authority",
  );
});

test("obsolete downstream 3D authority is physically absent", () => {
  for (const path of [
    "src/three-renderer.js",
    "src/live-physics3d.js",
    "src/geometry3d.js",
    "src/physics3d.js",
    "src/readability3d.js",
    "src/readable-layout3d.js",
    "tests/geometry3d.test.mjs",
    "tests/physics3d.test.mjs",
    "tests/readability3d.test.mjs",
  ]) {
    assert.equal(existsSync(path), false, `${path} must be deleted`);
  }
});
