import { access, copyFile, cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_THREE_VERSION = '0.185.1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, '_site');
const generated = join(root, 'generated');
const vendor = join(generated, 'vendor', 'three');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const path of [
  join(vendor, 'three.module.js'),
  join(vendor, 'addons', 'controls', 'OrbitControls.js'),
  join(vendor, 'manifest.json'),
]) {
  await access(path);
}

const manifest = JSON.parse(await readFile(join(vendor, 'manifest.json'), 'utf8'));
assert(manifest.package === 'three', 'Three.js vendor manifest package mismatch');
assert(manifest.version === EXPECTED_THREE_VERSION,
  `Three.js vendor manifest version ${manifest.version} != ${EXPECTED_THREE_VERSION}`);
assert(manifest.files?.['three.module.js']?.sha256, 'Three.js vendor manifest lacks entry-module digest');
assert(manifest.files?.['addons/controls/OrbitControls.js']?.sha256,
  'Three.js vendor manifest lacks OrbitControls digest');

const html = await readFile(join(root, 'index.html'), 'utf8');
assert(html.includes('"three": "./vendor/three/three.module.js"'),
  'index.html import map must resolve three to the local Pages artifact');
assert(html.includes('"three/addons/": "./vendor/three/addons/"'),
  'index.html import map must resolve three/addons/ to the local Pages artifact');
assert(!/https?:\/\/[^\s"']*three(?:\.module)?(?:\.min)?\.js/i.test(html),
  'index.html must not load Three.js from a remote URL');

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });

for (const file of ['index.html', 'styles.css', 'package.json']) {
  await copyFile(join(root, file), join(site, file));
}
for (const directory of ['src', 'examples', 'docs']) {
  await cp(join(root, directory), join(site, directory), { recursive: true });
}

const generatedVendorPrefix = `${join(generated, 'vendor')}${sep}`;
await cp(generated, join(site, 'generated'), {
  recursive: true,
  filter: (source) => source !== join(generated, 'vendor') && !source.startsWith(generatedVendorPrefix),
});
await cp(vendor, join(site, 'vendor', 'three'), { recursive: true });

for (const path of [
  join(site, 'vendor', 'three', 'three.module.js'),
  join(site, 'vendor', 'three', 'addons', 'controls', 'OrbitControls.js'),
  join(site, 'vendor', 'three', 'manifest.json'),
]) {
  await access(path);
}

console.log(`Built reproducible static site with local three@${EXPECTED_THREE_VERSION} in _site/vendor/three`);
