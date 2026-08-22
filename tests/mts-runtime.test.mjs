import assert from "node:assert/strict";
import test from "node:test";

import { executeAbits, symbolicStackAlgebra } from "../generated/mts-core/public.js";
import { MTS_CORE_PROVENANCE } from "../generated/mts-core-provenance.js";
import { deserializerById } from "../src/deserializers.js";
import { parseAnum4 } from "../src/formats.js";

const EXPECTED = Object.freeze({
  package: "@mts/core",
  packageVersion: "0.10.0",
  mtsVersion: "v0.11",
  contract: "mts-contract/v0.11",
  conformance: "mts-conformance/v0.11",
  repository: "netkeep80/anum_docs",
  commit: "6b7f616c7b275310aebdbe998da13c5811c91391",
  artifactSha256: "6b4dbd701f46a6a339e20b892b8a5d9478bb40a9392415899291eb0fe30ddf9c",
});

function accepted(source) {
  return deserializerById("anum-v0.4").deserialize(parseAnum4(source));
}

test("accepted registry явно объявляет exact @mts/core / MTS v0.11", () => {
  const runtime = deserializerById("anum-v0.4");
  assert.equal(runtime.status, "accepted");
  assert.match(runtime.title, /@mts\/core \/ MTS v0\.11/);
});

test("generated runtime имеет exact accepted MTS v0.11 provenance", () => {
  assert.equal(MTS_CORE_PROVENANCE.package, EXPECTED.package);
  assert.equal(MTS_CORE_PROVENANCE.packageVersion, EXPECTED.packageVersion);
  assert.equal(MTS_CORE_PROVENANCE.contract, EXPECTED.contract);
  assert.equal(MTS_CORE_PROVENANCE.conformance, EXPECTED.conformance);
  assert.equal(MTS_CORE_PROVENANCE.repository, EXPECTED.repository);
  assert.equal(MTS_CORE_PROVENANCE.commit, EXPECTED.commit);
  assert.equal(MTS_CORE_PROVENANCE.artifactSha256, EXPECTED.artifactSha256);
  assert.match(MTS_CORE_PROVENANCE.treeSha256, /^[0-9a-f]{64}$/);
});

test("package semver не подменяет identity принятого MTS release", () => {
  assert.equal(EXPECTED.packageVersion, "0.10.0");
  assert.equal(EXPECTED.mtsVersion, "v0.11");
  assert.equal(MTS_CORE_PROVENANCE.contract, `mts-contract/${EXPECTED.mtsVersion}`);
  assert.notEqual(MTS_CORE_PROVENANCE.packageVersion, EXPECTED.mtsVersion.replace(/^v/, ""));
});

test("accepted laboratory result объявляет upstream semantic authority", () => {
  const result = accepted("[[10]]10");
  const authority = result.aset.provenance.semanticAuthority;
  assert.equal(authority.kind, "exact-generated-package");
  assert.equal(authority.package, EXPECTED.package);
  assert.equal(authority.version, EXPECTED.packageVersion);
  assert.equal(authority.contract, EXPECTED.contract);
  assert.equal(authority.conformance, EXPECTED.conformance);
  assert.equal(authority.upstreamRepository, EXPECTED.repository);
  assert.equal(authority.upstreamCommit, EXPECTED.commit);
  assert.equal(authority.artifactSha256, EXPECTED.artifactSha256);
  assert.equal(authority.generatedTreeSha256, MTS_CORE_PROVENANCE.treeSha256);
  assert.equal(authority.consumerLock, "anum-parser-mts-core-consumer-lock/v0.1");
});

test("accepted Q result равен прямому MTS v0.11 @mts/core.executeAbits", () => {
  for (const source of ["", "[]", "10", "[10]", "[[10]]", "1[0]1", "[[10]][01]"]) {
    const artifact = parseAnum4(source);
    const direct = executeAbits(artifact.symbols, symbolicStackAlgebra).denotation;
    const projected = accepted(source);

    function expression(ref) {
      if (["R", "O", "C", "L", "U"].includes(ref)) return ref;
      const link = projected.aset.links.find((item) => item.id === ref);
      assert.ok(link, `unknown ref ${ref}`);
      return `(${expression(link.start)}⟼${expression(link.end)})`;
    }

    assert.equal(expression(projected.result), direct, source || "ε");
  }
});

test("experimental group-value не объявляет @mts/core semantic authority", () => {
  const result = deserializerById("stack-group-value-v0").deserialize(parseAnum4("[[10]]"));
  assert.equal(result.aset.provenance.status, "experimental");
  assert.equal(result.aset.provenance.semanticAuthority, undefined);
});
