import assert from "node:assert/strict";
import test from "node:test";

import { executeAbits, symbolicStackAlgebra } from "../generated/mts-core/public.js";
import { MTS_CORE_PROVENANCE } from "../generated/mts-core-provenance.js";
import { deserializerById } from "../src/deserializers.js";
import { parseAnum4 } from "../src/formats.js";

const EXPECTED = Object.freeze({
  package: "@mts/core",
  version: "0.10.0",
  contract: "mts-contract/v0.10",
  conformance: "mts-conformance/v0.10",
  repository: "netkeep80/anum_docs",
  commit: "957c818d82bd3211f2a59547fff28e8ed0ec4331",
  artifactSha256: "0cd716b65fcdcfb8ca31ec3899f1a812f0b4c9dbfe46bfc1f31899b762cde007",
});

function accepted(source) {
  return deserializerById("anum-v0.4").deserialize(parseAnum4(source));
}

test("accepted registry явно объявляет exact @mts/core / MTS v0.10", () => {
  const runtime = deserializerById("anum-v0.4");
  assert.equal(runtime.status, "accepted");
  assert.match(runtime.title, /@mts\/core \/ MTS v0\.10/);
});

test("generated runtime имеет exact accepted MTS v0.10 provenance", () => {
  assert.equal(MTS_CORE_PROVENANCE.package, EXPECTED.package);
  assert.equal(MTS_CORE_PROVENANCE.packageVersion, EXPECTED.version);
  assert.equal(MTS_CORE_PROVENANCE.contract, EXPECTED.contract);
  assert.equal(MTS_CORE_PROVENANCE.conformance, EXPECTED.conformance);
  assert.equal(MTS_CORE_PROVENANCE.repository, EXPECTED.repository);
  assert.equal(MTS_CORE_PROVENANCE.commit, EXPECTED.commit);
  assert.equal(MTS_CORE_PROVENANCE.artifactSha256, EXPECTED.artifactSha256);
  assert.match(MTS_CORE_PROVENANCE.treeSha256, /^[0-9a-f]{64}$/);
});

test("accepted laboratory result объявляет upstream semantic authority", () => {
  const result = accepted("[[10]]10");
  const authority = result.aset.provenance.semanticAuthority;
  assert.equal(authority.kind, "exact-generated-package");
  assert.equal(authority.package, EXPECTED.package);
  assert.equal(authority.version, EXPECTED.version);
  assert.equal(authority.contract, EXPECTED.contract);
  assert.equal(authority.conformance, EXPECTED.conformance);
  assert.equal(authority.upstreamRepository, EXPECTED.repository);
  assert.equal(authority.upstreamCommit, EXPECTED.commit);
  assert.equal(authority.artifactSha256, EXPECTED.artifactSha256);
  assert.equal(authority.generatedTreeSha256, MTS_CORE_PROVENANCE.treeSha256);
  assert.equal(authority.consumerLock, "anum-parser-mts-core-consumer-lock/v0.1");
});

test("accepted result равен прямому @mts/core.executeAbits", () => {
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
