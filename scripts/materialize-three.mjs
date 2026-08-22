import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_VERSION = '0.185.1';
const EXPECTED_RESOLVED = 'https://registry.npmjs.org/three/-/three-0.185.1.tgz';
const EXPECTED_INTEGRITY = 'sha512-5aojFCXKwnjBRZvUnt3WFfEcvUJgkN5LlijRFN95hMy8WVkG4I0QNcJE+OuWvuJ0bOdStrbfXn0pkd6/QyiAlg==';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = join(root, 'package.json');
const lockPath = join(root, 'package-lock.json');
const installedPackagePath = join(root, 'node_modules', 'three', 'package.json');
const sourceRoot = join(root, 'node_modules', 'three');
const outputRoot = join(root, 'generated', 'vendor', 'three');

const sources = [
  ['three.module.js', join(sourceRoot, 'build', 'three.module.js')],
  ['addons/controls/OrbitControls.js', join(sourceRoot, 'examples', 'jsm', 'controls', 'OrbitControls.js')],
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

const packageJson = await readJson(packageJsonPath);
const lock = await readJson(lockPath);
const installed = await readJson(installedPackagePath);
const lockedThree = lock.packages?.['node_modules/three'];

assert(packageJson.dependencies?.three === EXPECTED_VERSION,
  `package.json must exact-pin three=${EXPECTED_VERSION}`);
assert(lock.lockfileVersion === 3, 'package-lock.json must use lockfileVersion=3');
assert(lock.packages?.['']?.dependencies?.three === EXPECTED_VERSION,
  `lock root must exact-pin three=${EXPECTED_VERSION}`);
assert(lockedThree?.version === EXPECTED_VERSION,
  `lock must contain three ${EXPECTED_VERSION}`);
assert(lockedThree?.resolved === EXPECTED_RESOLVED,
  'locked Three.js tarball URL differs from the accepted exact artifact');
assert(lockedThree?.integrity === EXPECTED_INTEGRITY,
  'locked Three.js integrity differs from the accepted exact artifact');
assert(installed.version === EXPECTED_VERSION,
  `installed three version ${installed.version} != ${EXPECTED_VERSION}`);

await rm(outputRoot, { recursive: true, force: true });

const files = {};
for (const [target, source] of sources) {
  const destination = join(outputRoot, target);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  files[target] = {
    source: relative(root, source).replaceAll('\\', '/'),
    sha256: await sha256(destination),
  };
}

const manifest = {
  package: 'three',
  version: EXPECTED_VERSION,
  resolved: EXPECTED_RESOLVED,
  integrity: EXPECTED_INTEGRITY,
  files,
};
await writeFile(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const threeModule = await import(`${pathToFileURL(join(outputRoot, 'three.module.js')).href}?verify=${Date.now()}`);
assert(typeof threeModule.WebGLRenderer === 'function', 'local Three.js module must export WebGLRenderer');

const controlsModule = await import(`${pathToFileURL(join(outputRoot, 'addons', 'controls', 'OrbitControls.js')).href}?verify=${Date.now()}`);
assert(typeof controlsModule.OrbitControls === 'function', 'local OrbitControls module must export OrbitControls');

console.log(`Materialized exact three@${EXPECTED_VERSION} browser modules in generated/vendor/three`);
