import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

const lockPath = resolve("contracts/mts-core-consumer-lock.json");
const generatedRoot = resolve("generated");
const target = join(generatedRoot, "mts-core");
const markerPath = join(generatedRoot, "mts-core-provenance.json");
const markerModulePath = join(generatedRoot, "mts-core-provenance.js");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));

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

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function treeSha256(root) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        walk(path);
      } else if (stat.isFile()) {
        const rel = relative(root, path).replaceAll("\\", "/");
        hash.update(rel);
        hash.update("\0");
        hash.update(readFileSync(path));
        hash.update("\0");
      }
    }
  };
  walk(root);
  return hash.digest("hex");
}

function expectedMarker(treeDigest) {
  return {
    schema: "anum-parser-generated-mts-core/v0.1",
    repository: lock.repository,
    commit: lock.commit,
    contract: lock.accepted.contract.schema,
    conformance: lock.accepted.conformance.schema,
    package: lock.package.name,
    packageVersion: lock.package.version,
    artifactSha256: lock.package.sha256,
    treeSha256: treeDigest,
  };
}

function markerModule(marker) {
  return `export const MTS_CORE_PROVENANCE = Object.freeze(${JSON.stringify(marker, null, 2)});\n`;
}

function cacheIsValid() {
  if (
    !existsSync(join(target, "public.js")) ||
    !existsSync(markerPath) ||
    !existsSync(markerModulePath)
  ) return false;
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    const expected = expectedMarker(treeSha256(target));
    return (
      JSON.stringify(marker) === JSON.stringify(expected) &&
      readFileSync(markerModulePath, "utf8") === markerModule(expected)
    );
  } catch {
    return false;
  }
}

assert.equal(lock.schema, "anum-parser-mts-core-consumer-lock/v0.1");
assert.equal(lock.channel, "accepted-current");
assert.match(lock.commit, /^[0-9a-f]{40}$/);
assert.equal(lock.authority.floatingRefAllowed, false);
assert.equal(lock.authority.candidateAllowedAsCurrent, false);

if (cacheIsValid()) {
  console.log(`generated runtime already verified: ${lock.package.name}@${lock.package.version}`);
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "anum-parser-materialize-mts-"));
try {
  const source = join(scratch, "anum_docs");
  run("git", ["init", "--quiet", source], scratch);
  run("git", ["-C", source, "remote", "add", "origin", `https://github.com/${lock.repository}.git`], scratch);
  run("git", ["-C", source, "fetch", "--quiet", "--depth=1", "origin", lock.commit], scratch);
  run("git", ["-C", source, "checkout", "--quiet", "--detach", "FETCH_HEAD"], scratch);
  assert.equal(run("git", ["-C", source, "rev-parse", "HEAD"], scratch), lock.commit);

  const contract = JSON.parse(readFileSync(join(source, lock.accepted.contract.path), "utf8"));
  const conformance = JSON.parse(readFileSync(join(source, lock.accepted.conformance.path), "utf8"));
  assert.equal(contract.schema, lock.accepted.contract.schema);
  assert.equal(contract.status, "accepted");
  assert.equal(contract.accepted, true);
  assert.equal(conformance.schema, lock.accepted.conformance.schema);
  assert.equal(conformance.contract, lock.accepted.contract.schema);
  assert.equal(conformance.status, "accepted");
  assert.equal(conformance.accepted, true);
  assert.equal(conformance.coverageState, "complete");

  const packageRoot = join(source, lock.package.root);
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, lock.package.name);
  assert.equal(manifest.version, lock.package.version);

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], packageRoot);
  run(npm, ["run", "build", "--silent"], packageRoot);

  const artifacts = join(scratch, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  const packed = JSON.parse(run(npm, ["pack", "--json", "--pack-destination", artifacts], packageRoot));
  assert.equal(packed.length, 1);
  assert.equal(packed[0].filename, lock.package.artifact);
  const artifact = join(artifacts, packed[0].filename);
  assert.equal(fileSha256(artifact), lock.package.sha256, "packed @mts/core digest mismatch");

  rmSync(target, { recursive: true, force: true });
  mkdirSync(generatedRoot, { recursive: true });
  cpSync(join(packageRoot, "dist", "src"), target, { recursive: true });
  assert.ok(existsSync(join(target, "public.js")), "generated @mts/core public.js missing");

  const marker = expectedMarker(treeSha256(target));
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  writeFileSync(markerModulePath, markerModule(marker), "utf8");
  assert.equal(cacheIsValid(), true, "generated @mts/core cache verification failed");

  console.log(`materialized ${lock.package.name}@${lock.package.version}`);
  console.log(`source=${lock.repository}@${lock.commit}`);
  console.log(`artifact=${basename(artifact)} sha256=${lock.package.sha256}`);
  console.log(`generated.tree.sha256=${marker.treeSha256}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
