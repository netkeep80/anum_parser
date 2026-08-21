import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LOCK_PATH = resolve("contracts/mts-core-consumer-lock.json");
const DIFFERENTIAL_PATH = resolve("contracts/mts-v010-differential.json");
const CORPUS_PATH = resolve("examples/cases.json");
const FULL_SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout.trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertLockedDocument(actual, expected, label) {
  for (const [field, value] of Object.entries(expected)) {
    assert.deepEqual(actual[field], value, `${label}.${field} does not match consumer lock`);
  }
}

const lock = readJson(LOCK_PATH);
const differential = readJson(DIFFERENTIAL_PATH);
const corpus = readJson(CORPUS_PATH);

assert.equal(lock.schema, "anum-parser-mts-core-consumer-lock/v0.1");
assert.equal(lock.channel, "accepted-current");
assert.match(lock.repository, REPOSITORY);
assert.match(lock.commit, FULL_SHA);
assert.equal(lock.authority.floatingRefAllowed, false);
assert.equal(lock.authority.candidateAllowedAsCurrent, false);
assert.equal(lock.authority.deepSourceImportAllowed, false);
assert.equal(lock.authority.vendoredCurrentSemanticSourceAllowed, false);
assert.match(lock.package.sha256, /^[0-9a-f]{64}$/);

assert.equal(differential.schema, "anum-parser-mts-differential/v0.1");
assert.equal(differential.consumerLock.schema, lock.schema);
assert.equal(differential.consumerLock.repository, lock.repository);
assert.equal(differential.consumerLock.commit, lock.commit);
assert.equal(differential.consumerLock.contract, lock.accepted.contract.schema);
assert.equal(differential.consumerLock.package, `${lock.package.name}@${lock.package.version}`);
assert.equal(differential.semanticExecution.status, "parity-required");
assert.equal(differential.algorithmFailures.status, "parity-required");
assert.equal(
  differential.sourceFormatBoundary.classification,
  "presentation-boundary-not-semantic-mismatch",
);
assert.equal(differential.candidatePolicy.v011AllowedAsCurrent, false);

const acceptedCases = corpus.filter((item) =>
  item.format === "anum4" &&
  item.algorithm === "anum-v0.4" &&
  item.expectError === undefined
);
assert.equal(acceptedCases.length, differential.semanticExecution.acceptedCaseCount);

const scratch = mkdtempSync(join(tmpdir(), "anum-parser-mts-core-"));
try {
  const source = join(scratch, "anum_docs");
  const repositoryUrl = `https://github.com/${lock.repository}.git`;

  run("git", ["init", "--quiet", source], scratch);
  run("git", ["-C", source, "remote", "add", "origin", repositoryUrl], scratch);
  run("git", ["-C", source, "fetch", "--quiet", "--depth=1", "origin", lock.commit], scratch);
  run("git", ["-C", source, "checkout", "--quiet", "--detach", "FETCH_HEAD"], scratch);
  assert.equal(run("git", ["-C", source, "rev-parse", "HEAD"], scratch), lock.commit);

  const contract = readJson(join(source, lock.accepted.contract.path));
  const conformance = readJson(join(source, lock.accepted.conformance.path));
  assertLockedDocument(contract, {
    schema: lock.accepted.contract.schema,
    status: lock.accepted.contract.status,
    accepted: lock.accepted.contract.accepted,
  }, "contract");
  assertLockedDocument(conformance, {
    schema: lock.accepted.conformance.schema,
    contract: lock.accepted.conformance.contract,
    status: lock.accepted.conformance.status,
    accepted: lock.accepted.conformance.accepted,
    coverageState: lock.accepted.conformance.coverageState,
  }, "conformance");
  assert.equal(contract.conformanceCorpus, lock.accepted.conformance.path);
  assert.equal(contract.implementation.package, lock.package.name);
  assert.equal(contract.implementation.packageManifest, `${lock.package.root}/package.json`);

  const packageRoot = join(source, lock.package.root);
  const manifest = readJson(join(packageRoot, "package.json"));
  assert.equal(manifest.name, lock.package.name);
  assert.equal(manifest.version, lock.package.version);
  assert.deepEqual(manifest.files, ["dist/src"]);

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], packageRoot);
  run(npm, ["run", "build", "--silent"], packageRoot);

  const artifacts = join(scratch, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  const packed = JSON.parse(run(npm, ["pack", "--json", "--pack-destination", artifacts], packageRoot));
  assert.equal(packed.length, 1, "npm pack must emit exactly one artifact");
  assert.equal(packed[0].filename, lock.package.artifact);
  const artifact = join(artifacts, packed[0].filename);
  const digest = sha256(artifact);
  assert.equal(digest, lock.package.sha256, "@mts/core artifact SHA256 does not match consumer lock");

  const consumer = join(scratch, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), `${JSON.stringify({
    name: "anum-parser-mts-core-consumer-smoke",
    private: true,
    type: "module",
    dependencies: { "@mts/core": `file:${artifact}` },
  }, null, 2)}\n`, "utf8");
  run(npm, ["install", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund"], consumer);

  const formatsUrl = pathToFileURL(resolve("src/formats.js")).href;
  const deserializersUrl = pathToFileURL(resolve("src/deserializers.js")).href;
  const modelUrl = pathToFileURL(resolve("src/model.js")).href;
  const validSources = acceptedCases.map((item) => item.source);

  writeFileSync(join(consumer, "smoke.mjs"), [
    'import assert from "node:assert/strict";',
    'import {',
    '  Memory,',
    '  ensureRootBasis,',
    '  parseRawQuaternary,',
    '  deserializeAnum,',
    '  executeAbits,',
    '  symbolicStackAlgebra,',
    '} from "@mts/core";',
    `import { parseAnum4 } from ${JSON.stringify(formatsUrl)};`,
    `import { deserializerById } from ${JSON.stringify(deserializersUrl)};`,
    `import { linkMap } from ${JSON.stringify(modelUrl)};`,
    '',
    'const ROOT_REFS = new Set(["R", "O", "C", "L", "U"]);',
    'function semanticExpression(aset, ref) {',
    '  if (ROOT_REFS.has(ref)) return ref;',
    '  const link = linkMap(aset).get(ref);',
    '  assert.ok(link, `unknown local link ${ref}`);',
    '  return `(${semanticExpression(aset, link.start)}⟼${semanticExpression(aset, link.end)})`;',
    '}',
    'function localAccepted(source) {',
    '  const artifact = parseAnum4(source);',
    '  return deserializerById("anum-v0.4").deserialize(artifact);',
    '}',
    '',
    'const memory = new Memory();',
    'const basis = ensureRootBasis(memory);',
    'assert.equal(memory.root, basis.R);',
    'assert.equal(memory.find(basis.O, basis.C), basis.L);',
    'assert.deepEqual(memory.poles(basis.L), { start: basis.O, end: basis.C });',
    'assert.equal(deserializeAnum(parseRawQuaternary("[]"), symbolicStackAlgebra).denotation, "R");',
    'assert.equal(deserializeAnum(parseRawQuaternary("10"), symbolicStackAlgebra).denotation, "(L⟼U)");',
    '',
    `const validSources = ${JSON.stringify(validSources)};`,
    'for (const source of validSources) {',
    '  const artifact = parseAnum4(source);',
    '  const local = localAccepted(source);',
    '  const localValue = semanticExpression(local.aset, local.result);',
    '  const upstreamValue = executeAbits(artifact.symbols, symbolicStackAlgebra).denotation;',
    '  assert.equal(localValue, upstreamValue, `semantic differential failed for ${JSON.stringify(source)}`);',
    '}',
    '',
    'for (const source of ["]", "[", "[[10]", "10]", "10[[0]"]) {',
    '  let localTransition = null;',
    '  try { localAccepted(source); } catch (error) { localTransition = error?.detail?.transition ?? null; }',
    '  let upstreamCode = null;',
    '  try { executeAbits(Array.from(source), symbolicStackAlgebra); } catch (error) { upstreamCode = error?.code ?? null; }',
    '  assert.ok(localTransition, `local failure missing for ${source}`);',
    '  assert.equal(localTransition, upstreamCode, `failure differential failed for ${source}`);',
    '}',
    '',
    'for (const source of ["[1 0]", "[10]\\n", "1 # comment\\n0"]) {',
    '  assert.throws(() => parseAnum4(source), (error) => error?.code === "invalid-abit-symbol");',
    '  const normalized = parseRawQuaternary(source);',
    '  assert.ok(normalized.tokens.length > 0, `upstream raw normalization expected for ${JSON.stringify(source)}`);',
    '}',
    'assert.throws(() => parseAnum4("∞"), (error) => error?.code === "invalid-abit-symbol");',
    'assert.throws(() => parseRawQuaternary("∞"), (error) => error?.code === "non-abit");',
    '',
    'let deepImportRejected = false;',
    'try { await import("@mts/core/dist/src/memory.js"); } catch (error) {',
    '  deepImportRejected = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";',
    '}',
    'assert.equal(deepImportRejected, true, "deep upstream source import must remain unavailable");',
    `console.log("semantic differential: ${validSources.length} accepted cases parity");`,
    'console.log("source-format differential: classified presentation boundary");',
    '',
  ].join("\n"), "utf8");
  run(process.execPath, ["smoke.mjs"], consumer);

  console.log(`verified ${lock.package.name}@${lock.package.version}`);
  console.log(`channel=${lock.channel}`);
  console.log(`source=${lock.repository}@${lock.commit}`);
  console.log(`artifact.sha256=${digest}`);
  console.log(`differential.acceptedCases=${acceptedCases.length}`);
  console.log(`differential.sourceBoundary=${differential.sourceFormatBoundary.classification}`);
  console.log(`producer-record=node ${lock.package.producer.node} / npm ${lock.package.producer.npm}`);
  console.log(`verifier-runtime=node ${process.versions.node} / npm ${run(npm, ["--version"], scratch)}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
