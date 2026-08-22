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
const CURRENT_DIFFERENTIAL_PATH = resolve("contracts/mts-v011-differential.json");
const PREVIOUS_DIFFERENTIAL_PATH = resolve("contracts/mts-v010-differential.json");
const CORPUS_PATH = resolve("examples/cases.json");
const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHARED_FAILURE_SOURCES = ["]", "[", "[[10]", "10]", "10[[0]"];

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
    assert.deepEqual(actual[field], value, `${label}.${field} does not match locked evidence`);
  }
}

function schemaPath(schema) {
  return `contracts/${schema.replace("/", "-")}.json`;
}

function packageIdentity(value) {
  const split = value.lastIndexOf("@");
  assert.ok(split > 0, `invalid package identity: ${value}`);
  return { name: value.slice(0, split), version: value.slice(split + 1) };
}

function cloneAndPack(spec, label, scratch, npm) {
  assert.match(spec.repository, REPOSITORY);
  assert.match(spec.commit, FULL_SHA);
  assert.match(spec.digest, SHA256);

  const source = join(scratch, `source-${label}`);
  const repositoryUrl = `https://github.com/${spec.repository}.git`;
  run("git", ["init", "--quiet", source], scratch);
  run("git", ["-C", source, "remote", "add", "origin", repositoryUrl], scratch);
  run("git", ["-C", source, "fetch", "--quiet", "--depth=1", "origin", spec.commit], scratch);
  run("git", ["-C", source, "checkout", "--quiet", "--detach", "FETCH_HEAD"], scratch);
  assert.equal(run("git", ["-C", source, "rev-parse", "HEAD"], scratch), spec.commit);

  const contract = readJson(join(source, spec.contractPath));
  const conformance = readJson(join(source, spec.conformancePath));
  assertLockedDocument(contract, {
    schema: spec.contractSchema,
    status: "accepted",
    accepted: true,
  }, `${label}.contract`);
  assertLockedDocument(conformance, {
    schema: spec.conformanceSchema,
    contract: spec.contractSchema,
    status: "accepted",
    accepted: true,
    coverageState: "complete",
  }, `${label}.conformance`);
  assert.equal(contract.conformanceCorpus, spec.conformancePath);
  assert.equal(contract.implementation.package, spec.packageName);
  assert.equal(contract.implementation.packageManifest, `${spec.packageRoot}/package.json`);

  const packageRoot = join(source, spec.packageRoot);
  const manifest = readJson(join(packageRoot, "package.json"));
  assert.equal(manifest.name, spec.packageName);
  assert.equal(manifest.version, spec.packageVersion);
  assert.deepEqual(manifest.files, ["dist/src"]);

  run(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], packageRoot);
  run(npm, ["run", "build", "--silent"], packageRoot);

  const artifactDir = join(scratch, `artifact-${label}`);
  mkdirSync(artifactDir, { recursive: true });
  const packed = JSON.parse(run(
    npm,
    ["pack", "--json", "--pack-destination", artifactDir],
    packageRoot,
  ));
  assert.equal(packed.length, 1, `${label}: npm pack must emit exactly one artifact`);
  assert.equal(packed[0].filename, spec.artifactName);
  const artifact = join(artifactDir, packed[0].filename);
  const digest = sha256(artifact);
  assert.equal(digest, spec.digest, `${label}: @mts/core artifact SHA256 mismatch`);

  return { source, artifact, digest, contract, conformance };
}

function observePackage(artifact, label, validSources, scratch, npm) {
  const consumer = join(scratch, `observer-${label}`);
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), `${JSON.stringify({
    name: `anum-parser-${label}-observer`,
    private: true,
    type: "module",
    dependencies: { "@mts/core": `file:${artifact}` },
  }, null, 2)}\n`, "utf8");
  run(npm, ["install", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund"], consumer);

  writeFileSync(join(consumer, "observe.mjs"), [
    'import assert from "node:assert/strict";',
    'import { Memory, ensureRootBasis, executeAbits, symbolicStackAlgebra } from "@mts/core";',
    `const validSources = ${JSON.stringify(validSources)};`,
    `const failureSources = ${JSON.stringify(SHARED_FAILURE_SOURCES)};`,
    'const memory = new Memory();',
    'const basis = ensureRootBasis(memory);',
    'assert.equal(memory.root, basis.R);',
    'assert.equal(memory.find(basis.O, basis.C), basis.L);',
    'assert.deepEqual(memory.poles(basis.L), { start: basis.O, end: basis.C });',
    'const denotations = validSources.map((source) => executeAbits(Array.from(source), symbolicStackAlgebra).denotation);',
    'const failures = failureSources.map((source) => {',
    '  try { executeAbits(Array.from(source), symbolicStackAlgebra); return null; }',
    '  catch (error) { return error?.code ?? null; }',
    '});',
    'let deepImportRejected = false;',
    'try { await import("@mts/core/dist/src/memory.js"); } catch (error) {',
    '  deepImportRejected = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";',
    '}',
    'assert.equal(deepImportRejected, true);',
    'process.stdout.write(JSON.stringify({ denotations, failures, deepImportRejected }));',
    '',
  ].join("\n"), "utf8");

  return JSON.parse(run(process.execPath, ["observe.mjs"], consumer));
}

function verifyAcceptedV011(contract, conformance, differential) {
  assert.equal(contract.schema, "mts-contract/v0.11");
  assert.equal(contract.status, "accepted");
  assert.equal(contract.accepted, true);
  assert.equal(contract.acceptanceReady, true);
  assert.equal(contract.observableSemanticDelta, true);
  assert.equal(contract.acceptedCurrent, "mts-contract/v0.11");
  assert.equal(contract.implementation.package, "@mts/core");
  assert.equal(contract.implementation.publicFacade, "ts/src/public.ts");
  assert.equal(contract.implementation.candidateRuntimeSelectable, false);

  assert.deepEqual(contract.foundation.qAlphabet, ["[", "]", "1", "0"]);
  assert.equal(contract.foundation.qAlphabetCount, 4);
  assert.equal(contract.foundation.dotIsQAbit, false);
  assert.equal(contract.foundation.colonIsQAbit, false);
  assert.equal(contract.zeroContextGenesis.topLevelBinding, "TopBind(R,S)");
  assert.equal(contract.zeroContextGenesis.topLevelDotResolution, "resolve_top(.) = R");
  assert.equal(contract.dotPairGenesis.physicalSource, "..");
  assert.equal(contract.dotPairGenesis.exactOccurrenceCount, 2);
  assert.deepEqual(contract.dotPairGenesis.resolvedValuesAtRoot, ["R", "R"]);
  assert.equal(contract.dotPairGenesis.exactSequencePreservesBothPositions, true);
  assert.equal(contract.dotPairGenesis.semanticFoldAtRoot, "Pair(R,R) = R");
  assert.equal(contract.contextualDuality.bindingForm, "A : E");
  assert.equal(contract.contextualDuality.explicitResolution, "resolve_A(.) = A");
  assert.equal(
    contract.contextualDuality.nestedBinding,
    "nearest structural A : E binds dot occurrences in E",
  );
  assert.deepEqual(contract.qBoundary.alphabet, ["[", "]", "1", "0"]);
  assert.equal(contract.qBoundary.dotAdmitted, false);
  assert.equal(contract.qBoundary.colonAdmitted, false);
  assert.equal(contract.qBoundary.dotInsideQFormsAdmitted, false);
  assert.equal(contract.qBoundary.contextualBinderInheritanceIntoQ, false);

  assert.equal(conformance.status, "accepted");
  assert.equal(conformance.accepted, true);
  assert.equal(conformance.acceptanceReady, true);
  assert.equal(conformance.coverageState, "complete");
  assert.deepEqual(conformance.acceptanceBlockers, []);

  const delta = differential.acceptedSemanticDelta;
  assert.equal(delta.observableSemanticDelta, contract.observableSemanticDelta);
  assert.equal(delta.topLevelBinding, contract.zeroContextGenesis.topLevelBinding);
  assert.equal(delta.topLevelDotResolution, contract.zeroContextGenesis.topLevelDotResolution);
  assert.equal(delta.dotPair.source, contract.dotPairGenesis.physicalSource);
  assert.equal(delta.dotPair.exactOccurrenceCount, contract.dotPairGenesis.exactOccurrenceCount);
  assert.deepEqual(delta.dotPair.resolvedValuesAtRoot, contract.dotPairGenesis.resolvedValuesAtRoot);
  assert.equal(delta.dotPair.semanticFoldAtRoot, contract.dotPairGenesis.semanticFoldAtRoot);
  assert.equal(delta.nestedExplicitBinding, contract.contextualDuality.nestedBinding);
  assert.deepEqual(delta.qBoundary.alphabet, contract.qBoundary.alphabet);
  assert.equal(delta.qBoundary.dotAdmitted, contract.qBoundary.dotAdmitted);
  assert.equal(delta.qBoundary.colonAdmitted, contract.qBoundary.colonAdmitted);
  assert.equal(
    delta.qBoundary.contextualBinderInheritanceIntoQ,
    contract.qBoundary.contextualBinderInheritanceIntoQ,
  );
}

const lock = readJson(LOCK_PATH);
const currentDifferential = readJson(CURRENT_DIFFERENTIAL_PATH);
const previousDifferential = readJson(PREVIOUS_DIFFERENTIAL_PATH);
const corpus = readJson(CORPUS_PATH);

assert.equal(lock.schema, "anum-parser-mts-core-consumer-lock/v0.1");
assert.equal(lock.channel, "accepted-current");
assert.match(lock.repository, REPOSITORY);
assert.match(lock.commit, FULL_SHA);
assert.equal(lock.authority.floatingRefAllowed, false);
assert.equal(lock.authority.candidateAllowedAsCurrent, false);
assert.equal(lock.authority.deepSourceImportAllowed, false);
assert.equal(lock.authority.vendoredCurrentSemanticSourceAllowed, false);
assert.match(lock.package.sha256, SHA256);

assert.equal(currentDifferential.schema, "anum-parser-mts-differential/v0.2");
assert.equal(currentDifferential.issue, 46);
assert.equal(currentDifferential.currentConsumer.lockSchema, lock.schema);
assert.equal(currentDifferential.currentConsumer.repository, lock.repository);
assert.equal(currentDifferential.currentConsumer.commit, lock.commit);
assert.equal(currentDifferential.currentConsumer.contract, lock.accepted.contract.schema);
assert.equal(currentDifferential.currentConsumer.conformance, lock.accepted.conformance.schema);
assert.equal(
  currentDifferential.currentConsumer.package,
  `${lock.package.name}@${lock.package.version}`,
);
assert.equal(currentDifferential.currentConsumer.artifactSha256, lock.package.sha256);
assert.equal(currentDifferential.semanticExecution.status, "current-vs-previous-parity-required");
assert.equal(currentDifferential.algorithmFailures.status, "current-vs-previous-parity-required");
assert.equal(
  currentDifferential.sourceFormatBoundary.classification,
  "presentation-boundary-not-semantic-mismatch",
);
assert.equal(currentDifferential.packageBoundary.rootImportRequired, true);
assert.equal(currentDifferential.packageBoundary.deepImportRejected, true);
assert.equal(currentDifferential.packageBoundary.packageVersionDistinguishesMtsRelease, false);

assert.equal(previousDifferential.schema, "anum-parser-mts-differential/v0.1");
assert.equal(currentDifferential.previousAcceptedConsumer.evidence, "contracts/mts-v010-differential.json");
assert.equal(currentDifferential.previousAcceptedConsumer.immutable, true);
assert.equal(previousDifferential.consumerLock.repository, currentDifferential.previousAcceptedConsumer.repository);
assert.equal(previousDifferential.consumerLock.commit, currentDifferential.previousAcceptedConsumer.commit);
assert.equal(previousDifferential.consumerLock.contract, currentDifferential.previousAcceptedConsumer.contract);
assert.equal(previousDifferential.consumerLock.package, currentDifferential.previousAcceptedConsumer.package);
assert.equal(previousDifferential.semanticExecution.status, "parity-required");
assert.equal(previousDifferential.algorithmFailures.status, "parity-required");
assert.equal(previousDifferential.candidatePolicy.v011AllowedAsCurrent, false);

const acceptedCases = corpus.filter((item) =>
  item.format === "anum4" &&
  item.algorithm === "anum-v0.4" &&
  item.expectError === undefined
);
const validSources = acceptedCases.map((item) => item.source);
assert.equal(acceptedCases.length, currentDifferential.semanticExecution.acceptedCaseCount);
assert.equal(acceptedCases.length, previousDifferential.semanticExecution.acceptedCaseCount);

const previousPackage = packageIdentity(currentDifferential.previousAcceptedConsumer.package);
assert.equal(previousPackage.name, lock.package.name);
assert.equal(previousPackage.version, lock.package.version);

const currentSpec = {
  repository: lock.repository,
  commit: lock.commit,
  contractSchema: lock.accepted.contract.schema,
  conformanceSchema: lock.accepted.conformance.schema,
  contractPath: lock.accepted.contract.path,
  conformancePath: lock.accepted.conformance.path,
  packageName: lock.package.name,
  packageVersion: lock.package.version,
  packageRoot: lock.package.root,
  artifactName: lock.package.artifact,
  digest: lock.package.sha256,
};
const previousSpec = {
  repository: currentDifferential.previousAcceptedConsumer.repository,
  commit: currentDifferential.previousAcceptedConsumer.commit,
  contractSchema: currentDifferential.previousAcceptedConsumer.contract,
  conformanceSchema: currentDifferential.previousAcceptedConsumer.conformance,
  contractPath: schemaPath(currentDifferential.previousAcceptedConsumer.contract),
  conformancePath: schemaPath(currentDifferential.previousAcceptedConsumer.conformance),
  packageName: previousPackage.name,
  packageVersion: previousPackage.version,
  packageRoot: lock.package.root,
  artifactName: lock.package.artifact,
  digest: currentDifferential.previousAcceptedConsumer.artifactSha256,
};

const scratch = mkdtempSync(join(tmpdir(), "anum-parser-mts-repin-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
try {
  const current = cloneAndPack(currentSpec, "current-v011", scratch, npm);
  const previous = cloneAndPack(previousSpec, "previous-v010", scratch, npm);
  verifyAcceptedV011(current.contract, current.conformance, currentDifferential);

  const currentObserved = observePackage(current.artifact, "current-v011", validSources, scratch, npm);
  const previousObserved = observePackage(previous.artifact, "previous-v010", validSources, scratch, npm);
  assert.deepEqual(
    currentObserved.denotations,
    previousObserved.denotations,
    "accepted v0.11 changed the shared Q denotation corpus relative to accepted v0.10",
  );
  assert.deepEqual(
    currentObserved.failures,
    previousObserved.failures,
    "accepted v0.11 changed shared Q failure classes relative to accepted v0.10",
  );
  assert.equal(currentObserved.deepImportRejected, true);
  assert.equal(previousObserved.deepImportRejected, true);

  const consumer = join(scratch, "current-local-smoke");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), `${JSON.stringify({
    name: "anum-parser-current-local-smoke",
    private: true,
    type: "module",
    dependencies: { "@mts/core": `file:${current.artifact}` },
  }, null, 2)}\n`, "utf8");
  run(npm, ["install", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund"], consumer);

  const formatsUrl = pathToFileURL(resolve("src/formats.js")).href;
  const deserializersUrl = pathToFileURL(resolve("src/deserializers.js")).href;
  const modelUrl = pathToFileURL(resolve("src/model.js")).href;
  writeFileSync(join(consumer, "smoke.mjs"), [
    'import assert from "node:assert/strict";',
    'import { parseRawQuaternary, deserializeAnum, executeAbits, symbolicStackAlgebra } from "@mts/core";',
    `import { parseAnum4 } from ${JSON.stringify(formatsUrl)};`,
    `import { deserializerById } from ${JSON.stringify(deserializersUrl)};`,
    `import { linkMap } from ${JSON.stringify(modelUrl)};`,
    `const validSources = ${JSON.stringify(validSources)};`,
    `const failureSources = ${JSON.stringify(SHARED_FAILURE_SOURCES)};`,
    'const ROOT_REFS = new Set(["R", "O", "C", "L", "U"]);',
    'function semanticExpression(aset, ref) {',
    '  if (ROOT_REFS.has(ref)) return ref;',
    '  const link = linkMap(aset).get(ref);',
    '  assert.ok(link, `unknown local link ${ref}`);',
    '  return `(${semanticExpression(aset, link.start)}⟼${semanticExpression(aset, link.end)})`;',
    '}',
    'function localAccepted(source) {',
    '  return deserializerById("anum-v0.4").deserialize(parseAnum4(source));',
    '}',
    'assert.equal(deserializeAnum(parseRawQuaternary("[]"), symbolicStackAlgebra).denotation, "R");',
    'assert.equal(deserializeAnum(parseRawQuaternary("10"), symbolicStackAlgebra).denotation, "(L⟼U)");',
    'for (const source of validSources) {',
    '  const artifact = parseAnum4(source);',
    '  const local = localAccepted(source);',
    '  const localValue = semanticExpression(local.aset, local.result);',
    '  const upstreamValue = executeAbits(artifact.symbols, symbolicStackAlgebra).denotation;',
    '  assert.equal(localValue, upstreamValue, `current semantic differential failed for ${JSON.stringify(source)}`);',
    '}',
    'for (const source of failureSources) {',
    '  let localTransition = null;',
    '  try { localAccepted(source); } catch (error) { localTransition = error?.detail?.transition ?? null; }',
    '  let upstreamCode = null;',
    '  try { executeAbits(Array.from(source), symbolicStackAlgebra); } catch (error) { upstreamCode = error?.code ?? null; }',
    '  assert.ok(localTransition, `local failure missing for ${source}`);',
    '  assert.equal(localTransition, upstreamCode, `current failure differential failed for ${source}`);',
    '}',
    'for (const source of ["[1 0]", "[10]\\n", "1 # comment\\n0"]) {',
    '  assert.throws(() => parseAnum4(source), (error) => error?.code === "invalid-abit-symbol");',
    '  assert.ok(parseRawQuaternary(source).tokens.length > 0);',
    '}',
    'assert.throws(() => parseAnum4("∞"), (error) => error?.code === "invalid-abit-symbol");',
    'assert.throws(() => parseRawQuaternary("∞"), (error) => error?.code === "non-abit");',
    '',
  ].join("\n"), "utf8");
  run(process.execPath, ["smoke.mjs"], consumer);

  console.log(`verified current ${lock.package.name}@${lock.package.version}`);
  console.log(`current.source=${currentSpec.repository}@${currentSpec.commit}`);
  console.log(`current.contract=${currentSpec.contractSchema}`);
  console.log(`current.artifact.sha256=${current.digest}`);
  console.log(`previous.source=${previousSpec.repository}@${previousSpec.commit}`);
  console.log(`previous.contract=${previousSpec.contractSchema}`);
  console.log(`previous.artifact.sha256=${previous.digest}`);
  console.log(`differential.sharedQ.acceptedCases=${acceptedCases.length}`);
  console.log(`differential.sharedQ.failures=${SHARED_FAILURE_SOURCES.length}`);
  console.log(`differential.v011Delta=${currentDifferential.acceptedSemanticDelta.consumerImpact}`);
  console.log(`differential.sourceBoundary=${currentDifferential.sourceFormatBoundary.classification}`);
  console.log(`producer-record=node ${lock.package.producer.node} / npm ${lock.package.producer.npm}`);
  console.log(`verifier-runtime=node ${process.versions.node} / npm ${run(npm, ["--version"], scratch)}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
