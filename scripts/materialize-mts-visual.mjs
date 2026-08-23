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
import { join, relative, resolve } from "node:path";

const lockPath = resolve("contracts/mts-visual-consumer-lock.json");
const generatedRoot = resolve("generated");
const target = join(generatedRoot, "mts-visual");
const markerPath = join(generatedRoot, "mts-visual-provenance.json");
const markerModulePath = join(generatedRoot, "mts-visual-provenance.js");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
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
    schema: "anum-parser-generated-mts-visual/v0.1",
    repository: lock.repository,
    commit: lock.commit,
    package: lock.package.name,
    packageVersion: lock.package.version,
    manifestGitBlobSha: lock.package.manifest.gitBlobSha,
    lockfileGitBlobSha: lock.package.lockfile.gitBlobSha,
    threeVersion: lock.package.dependencies.three,
    treeSha256: treeDigest,
  };
}

function markerModule(marker) {
  return `export const MTS_VISUAL_PROVENANCE = Object.freeze(${JSON.stringify(marker, null, 2)});\n`;
}

function cacheIsValid() {
  if (
    !existsSync(join(target, "index.js")) ||
    !existsSync(join(target, "three", "index.js")) ||
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

assert.equal(lock.schema, "anum-parser-mts-visual-consumer-lock/v0.1");
assert.equal(lock.channel, "accepted-presentation");
assert.match(lock.commit, /^[0-9a-f]{40}$/);
assert.equal(lock.repository, "netkeep80/mts_visual");
assert.equal(lock.package.name, "@mts/visual");
assert.equal(lock.package.version, "0.1.0");
assert.equal(lock.package.root, ".");
assert.equal(lock.package.dependencies.three, "0.185.1");
assert.equal(lock.authority.floatingRefAllowed, false);
assert.equal(lock.authority.deepSourceImportAllowed, false);
assert.equal(lock.authority.semanticAcceptanceClaimed, false);
assert.equal(lock.authority.semanticCoreLockIndependent, true);

if (cacheIsValid()) {
  console.log(`generated visual package already verified: ${lock.package.name}@${lock.package.version}`);
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "anum-parser-materialize-visual-"));
try {
  const source = join(scratch, "mts_visual");
  run("git", ["init", "--quiet", source], scratch);
  run("git", ["-C", source, "remote", "add", "origin", `https://github.com/${lock.repository}.git`], scratch);
  run("git", ["-C", source, "fetch", "--quiet", "--depth=1", "origin", lock.commit], scratch);
  run("git", ["-C", source, "checkout", "--quiet", "--detach", "FETCH_HEAD"], scratch);
  assert.equal(run("git", ["-C", source, "rev-parse", "HEAD"], scratch), lock.commit);

  assert.equal(
    run("git", ["-C", source, "hash-object", lock.package.manifest.path], scratch),
    lock.package.manifest.gitBlobSha,
    "@mts/visual package.json Git blob identity mismatch",
  );
  assert.equal(
    run("git", ["-C", source, "hash-object", lock.package.lockfile.path], scratch),
    lock.package.lockfile.gitBlobSha,
    "@mts/visual package-lock.json Git blob identity mismatch",
  );

  const packageRoot = join(source, lock.package.root);
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(join(packageRoot, "package-lock.json"), "utf8"));
  assert.equal(manifest.name, lock.package.name);
  assert.equal(manifest.version, lock.package.version);
  assert.equal(manifest.private, lock.package.private);
  assert.equal(manifest.dependencies?.three, lock.package.dependencies.three);
  assert.equal(manifest.devDependencies?.typescript, "5.9.3");
  assert.equal(packageLock.name, lock.package.name);
  assert.equal(packageLock.version, lock.package.version);
  assert.equal(packageLock.lockfileVersion, lock.package.lockfile.lockfileVersion);
  assert.equal(packageLock.packages?.[""]?.dependencies?.three, lock.package.dependencies.three);
  assert.equal(packageLock.packages?.[""]?.devDependencies?.typescript, "5.9.3");

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], packageRoot);
  run(npm, ["run", "build", "--silent"], packageRoot);

  const built = join(packageRoot, "dist", "src");
  assert.ok(existsSync(join(built, "index.js")), "built @mts/visual root entry missing");
  assert.ok(existsSync(join(built, "three", "index.js")), "built @mts/visual ./three entry missing");

  rmSync(target, { recursive: true, force: true });
  mkdirSync(generatedRoot, { recursive: true });
  cpSync(built, target, { recursive: true });

  const marker = expectedMarker(treeSha256(target));
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  writeFileSync(markerModulePath, markerModule(marker), "utf8");
  assert.equal(cacheIsValid(), true, "generated @mts/visual cache verification failed");

  console.log(`materialized ${lock.package.name}@${lock.package.version}`);
  console.log(`source=${lock.repository}@${lock.commit}`);
  console.log(`manifest.gitBlobSha=${lock.package.manifest.gitBlobSha}`);
  console.log(`lockfile.gitBlobSha=${lock.package.lockfile.gitBlobSha}`);
  console.log(`generated.tree.sha256=${marker.treeSha256}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
