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

const LOCK_PATH = resolve("contracts/mts-core-consumer-lock.json");
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
assert.equal(lock.schema, "anum-parser-mts-core-consumer-lock/v0.1");
assert.equal(lock.channel, "accepted-current");
assert.match(lock.repository, REPOSITORY);
assert.match(lock.commit, FULL_SHA);
assert.equal(lock.authority.floatingRefAllowed, false);
assert.equal(lock.authority.candidateAllowedAsCurrent, false);
assert.equal(lock.authority.deepSourceImportAllowed, false);
assert.equal(lock.authority.vendoredCurrentSemanticSourceAllowed, false);
assert.match(lock.package.sha256, /^[0-9a-f]{64}$/);

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

  writeFileSync(join(consumer, "smoke.mjs"), [
    'import assert from "node:assert/strict";',
    'import {',
    '  Memory,',
    '  ensureRootBasis,',
    '  parseRawQuaternary,',
    '  deserializeAnum,',
    '  symbolicStackAlgebra,',
    '} from "@mts/core";',
    'const memory = new Memory();',
    'const basis = ensureRootBasis(memory);',
    'assert.equal(memory.root, basis.R);',
    'assert.equal(memory.find(basis.O, basis.C), basis.L);',
    'assert.deepEqual(memory.poles(basis.L), { start: basis.O, end: basis.C });',
    'assert.equal(deserializeAnum(parseRawQuaternary("[]"), symbolicStackAlgebra).denotation, "R");',
    'assert.equal(deserializeAnum(parseRawQuaternary("10"), symbolicStackAlgebra).denotation, "(L⟼U)");',
    'let deepImportRejected = false;',
    'try { await import("@mts/core/dist/src/memory.js"); } catch (error) {',
    '  deepImportRejected = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";',
    '}',
    'assert.equal(deepImportRejected, true, "deep upstream source import must remain unavailable");',
    '',
  ].join("\n"), "utf8");
  run(process.execPath, ["smoke.mjs"], consumer);

  console.log(`verified ${lock.package.name}@${lock.package.version}`);
  console.log(`channel=${lock.channel}`);
  console.log(`source=${lock.repository}@${lock.commit}`);
  console.log(`artifact.sha256=${digest}`);
  console.log(`producer-record=node ${lock.package.producer.node} / npm ${lock.package.producer.npm}`);
  console.log(`verifier-runtime=node ${process.versions.node} / npm ${run(npm, ["--version"], scratch)}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
