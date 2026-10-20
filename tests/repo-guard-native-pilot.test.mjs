import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "node:test";
import {
  buildProviderBundle,
  PROVIDER_SOURCE,
  REPO_GUARD_SHA,
} from "../scripts/repo-guard-provider.mjs";

const REPOSITORY = "netkeep80/anum_parser";
const TRUSTED_WORKFLOW = ".github/workflows/trusted-enforcement.yml";
const NATIVE_SOURCE = /^requirements\/.*\.rg\.(?:yaml|json)$/;

function run(command, args, cwd, env = process.env) {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 40 * 1024 * 1024,
  }).trim();
}

function git(root, ...args) {
  return run("git", args, root);
}

function tracked(root = process.cwd()) {
  const raw = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return raw.split("\0").filter(Boolean).sort();
}

function materializeRepoGuard() {
  const root = mkdtempSync(join(tmpdir(), "anum-parser-repo-guard-"));
  run("git", ["init", "--quiet", root], process.cwd());
  run("git", ["-C", root, "remote", "add", "origin", "https://github.com/netkeep80/repo-guard.git"], process.cwd());
  run("git", ["-C", root, "fetch", "--quiet", "--depth=1", "origin", REPO_GUARD_SHA], process.cwd());
  run("git", ["-C", root, "checkout", "--quiet", "--detach", "FETCH_HEAD"], process.cwd());
  assert.equal(run("git", ["-C", root, "rev-parse", "HEAD"], process.cwd()), REPO_GUARD_SHA);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["install", "--omit=dev", "--silent", "--no-audit", "--no-fund"], root);
  return root;
}

function copyTrackedSnapshot(destination, includeNativeRequirements) {
  const sourceRoot = process.cwd();
  for (const path of tracked(sourceRoot)) {
    if (!includeNativeRequirements && NATIVE_SOURCE.test(path)) continue;
    const from = join(sourceRoot, path);
    if (!existsSync(from)) continue;
    const to = join(destination, path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
}

function commitAll(root, message) {
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

function resetScenario(root, base, name) {
  git(root, "checkout", "--quiet", "-B", name, base);
  git(root, "reset", "--hard", "--quiet", base);
  git(root, "clean", "-fdq");
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function exactReceipt(authorityBaseRevision, baseRevision, headRevision, permissions) {
  return { authorityBaseRevision, baseRevision, headRevision, permissions };
}

function refreshSourceEvent() {
  return {
    action: "edited",
    repository: { full_name: REPOSITORY },
    issue: { number: 135 },
    changes: { body: { from: "previous body" } },
  };
}

it("#135 native consumer A1-A16 / T1-T10 production-kernel matrix", {
  skip: !tracked().some((path) => NATIVE_SOURCE.test(path)),
}, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "anum-parser-native-pilot-"));
  const fixture = join(scratch, "consumer");
  mkdirSync(fixture, { recursive: true });
  git(fixture, "init", "-b", "main");
  git(fixture, "config", "user.email", "native-pilot@example.test");
  git(fixture, "config", "user.name", "Native Pilot");

  let repoGuardRoot = "";
  try {
    copyTrackedSnapshot(fixture, false);
    const legacy = commitAll(fixture, "synthetic exact legacy preinstall state");

    copyTrackedSnapshot(fixture, true);
    const native = commitAll(fixture, "synthetic exact native candidate state");
    const nativeTracked = tracked(fixture).length;

    repoGuardRoot = materializeRepoGuard();
    const pipeline = await import(pathToFileURL(join(repoGuardRoot, "dist/runtime/pipeline.mjs")).href);
    const githubPr = await import(pathToFileURL(join(repoGuardRoot, "dist/github-pr.mjs")).href);

    const migrationNoTrust = pipeline.evaluateNativeTrustedRootMigrationSnapshot({
      repository: REPOSITORY,
      repositoryRoot: fixture,
      trustedAuthorityBaseRevision: legacy,
      baseRevision: legacy,
      headRevision: native,
      trustedRootReceipt: null,
    });
    assert.equal(migrationNoTrust.candidateReady, true, migrationNoTrust.reasons.join(" | "));
    assert.deepEqual(migrationNoTrust.candidate.j2, { rooted: 9, unrooted: 0 });
    assert.equal(migrationNoTrust.candidate.j1.tracked, nativeTracked);
    assert.equal(migrationNoTrust.candidate.j1.justified, nativeTracked);
    assert.equal(migrationNoTrust.candidate.j1.unjustified, 0);
    assert.equal(migrationNoTrust.ok, false);
    assert.equal(migrationNoTrust.requiredPermissions.length, 9);

    const migrationReceipt = {
      repository: REPOSITORY,
      authorityBaseRevision: legacy,
      baseRevision: legacy,
      headRevision: native,
      permissions: migrationNoTrust.requiredPermissions,
    };
    const migration = pipeline.evaluateNativeTrustedRootMigrationSnapshot({
      repository: REPOSITORY,
      repositoryRoot: fixture,
      trustedAuthorityBaseRevision: legacy,
      baseRevision: legacy,
      headRevision: native,
      trustedRootReceipt: migrationReceipt,
    });
    assert.equal(migration.ok, true, migration.reasons.join(" | "));
    assert.deepEqual(migration.authorized.j2, { rooted: 9, unrooted: 0 });
    assert.equal(migration.authorized.j1.unjustified, 0);

    const staleMigration = pipeline.evaluateNativeTrustedRootMigrationSnapshot({
      repository: REPOSITORY,
      repositoryRoot: fixture,
      trustedAuthorityBaseRevision: legacy,
      baseRevision: legacy,
      headRevision: native,
      trustedRootReceipt: { ...migrationReceipt, headRevision: "f".repeat(40) },
    });
    assert.equal(staleMigration.ok, false);

    const bundleResult = (baseRevision, headRevision, eventName = "pull_request_target") => {
      const runnerTemp = mkdtempSync(join(scratch, "provider-"));
      const bundlePath = join(runnerTemp, "provider.json");
      const document = buildProviderBundle({
        repository: REPOSITORY,
        eventBaseRevision: baseRevision,
        eventHeadRevision: headRevision,
        repositoryRoot: fixture,
      });
      writeJson(bundlePath, document);
      const reevaluation = eventName === "issues"
        ? { kind: "linked-issue", sourceEvent: refreshSourceEvent() }
        : null;
      const result = githubPr.loadAuthenticatedProviderBundle({
        bundlePath,
        runnerTemp,
        eventName,
        reevaluation,
        repository: REPOSITORY,
        workflowRef: REPOSITORY + "/" + TRUSTED_WORKFLOW + "@refs/heads/main",
        workflowSha: baseRevision,
        event: {
          repository: { full_name: REPOSITORY },
          pull_request: { base: { sha: baseRevision }, head: { sha: headRevision } },
        },
        authorityBaseRevision: baseRevision,
        baseRevision,
        headRevision,
      });
      return { result, document, runnerTemp };
    };

    const evaluate = (baseRevision, headRevision, addresses, provider, trustedReceipts = []) =>
      pipeline.evaluateRepoGuardNativeBlockingSnapshot({
        repository: REPOSITORY,
        repositoryRoot: fixture,
        trustedAuthorityBaseRevision: native,
        baseRevision,
        headRevision,
        workIntent: { id: "pilot", addresses },
        trustedReceipts,
        protectedResources: provider.result.protectedResources,
        evidenceFacts: provider.result.evidenceFacts,
        observationFacts: provider.result.observationFacts,
        authenticatedProviderGrants: provider.result.authenticatedProviderGrants,
      });

    resetScenario(fixture, native, "ordinary-source");
    writeFileSync(join(fixture, "src", "model.js"),
      readFileSync(join(fixture, "src", "model.js"), "utf8") + "\n// native ordinary change\n");
    const ordinaryHead = commitAll(fixture, "ordinary native source change");
    const ordinaryProvider = bundleResult(native, ordinaryHead);
    assert.equal(ordinaryProvider.result.ok, true, ordinaryProvider.result.reasons.join(" | "));
    assert.equal(ordinaryProvider.result.authenticatedProviderGrants.length, 0);
    const ordinary = evaluate(native, ordinaryHead, ["ANP-CORE"], ordinaryProvider);
    assert.equal(ordinary.ok, true, ordinary.reasons.join(" | "));
    assert.equal(ordinary.providerCapabilityMode, true);
    assert.equal(ordinary.authenticatedProviderGrantCount, 0);

    const missingCause = evaluate(native, ordinaryHead, [], ordinaryProvider);
    assert.equal(missingCause.ok, false);
    assert.ok(missingCause.reasons.some((reason) => reason.startsWith("J3:no_cause:")));

    const selector = pipeline.selectRepoGuardAuthoritativeEvaluator({
      baseRepresentation: "native",
      headRepresentation: "native",
      forwardAuthorized: false,
      rollbackAuthorized: false,
    });
    assert.deepEqual(selector, { ok: true, evaluator: "native", transition: "steady" });

    resetScenario(fixture, native, "orphan-resource");
    writeFileSync(join(fixture, "orphan.txt"), "unjustified\n");
    const orphanResourceHead = commitAll(fixture, "add orphan resource");
    const orphanResourceProvider = bundleResult(native, orphanResourceHead);
    const orphanResource = evaluate(native, orphanResourceHead, ["ANP-CORE"], orphanResourceProvider);
    assert.equal(orphanResource.ok, false);
    assert.ok(orphanResource.reasons.includes("head:j1_not_closed"));

    resetScenario(fixture, native, "orphan-requirement");
    writeFileSync(join(fixture, "requirements", "anum-parser", "ANP-ORPHAN.rg.yaml"), [
      "format: repo-guard/requirement-v1",
      "id: ANP-ORPHAN",
      'normative: "Untrusted candidate root."',
      "relations: []",
      "",
    ].join("\n"));
    const orphanRequirementHead = commitAll(fixture, "add orphan requirement");
    const orphanRequirementProvider = bundleResult(native, orphanRequirementHead);
    const orphanRequirement = evaluate(native, orphanRequirementHead, ["ANP-ORPHAN"], orphanRequirementProvider);
    assert.equal(orphanRequirement.ok, false);
    assert.ok(orphanRequirement.reasons.some((reason) => reason.includes("j2")));

    resetScenario(fixture, native, "self-rooting");
    writeFileSync(join(fixture, "requirements", "anum-parser", "ANP-SELF.rg.yaml"), [
      "format: repo-guard/requirement-v1",
      "id: ANP-SELF",
      'normative: "Candidate self-root attempt."',
      "relations:",
      "  - predicates: [requires]",
      "    target:",
      "      kind: requirement",
      "      id: ANP-SELF",
      "",
    ].join("\n"));
    const selfRootHead = commitAll(fixture, "self root requirement");
    const selfRootProvider = bundleResult(native, selfRootHead);
    const selfRoot = evaluate(native, selfRootHead, ["ANP-SELF"], selfRootProvider);
    assert.equal(selfRoot.ok, false);
    assert.ok(selfRoot.reasons.some((reason) => reason.includes("j2")));

    const candidateBundleRoot = mkdtempSync(join(scratch, "candidate-provider-"));
    const candidateBundlePath = join(candidateBundleRoot, "provider.json");
    writeJson(candidateBundlePath, ordinaryProvider.document);
    const candidateTrust = githubPr.loadAuthenticatedProviderBundle({
      bundlePath: candidateBundlePath,
      runnerTemp: candidateBundleRoot,
      eventName: "pull_request",
      reevaluation: null,
      repository: REPOSITORY,
      workflowRef: REPOSITORY + "/.github/workflows/ci.yml@refs/pull/1/merge",
      workflowSha: ordinaryHead,
      event: {
        repository: { full_name: REPOSITORY },
        pull_request: { base: { sha: native }, head: { sha: ordinaryHead } },
      },
      authorityBaseRevision: native,
      baseRevision: native,
      headRevision: ordinaryHead,
    });
    assert.equal(candidateTrust.ok, false);
    assert.equal(candidateTrust.trustPresent, false);
    assert.deepEqual(candidateTrust.protectedResources, []);

    resetScenario(fixture, native, "requirement-transition");
    const corePath = join(fixture, "requirements", "anum-parser", "ANP-CORE.rg.yaml");
    writeFileSync(corePath, readFileSync(corePath, "utf8").replace(
      "implementation changes remain free when those observable contracts stay valid.",
      "implementation changes remain free when those observable contracts stay valid. The accepted requirement identity changes only with exact authority.",
    ));
    const requirementHead = commitAll(fixture, "authorized requirement transition");
    const requirementProvider = bundleResult(native, requirementHead);
    const requirementWithoutReceipt = evaluate(native, requirementHead, ["ANP-CORE"], requirementProvider);
    assert.equal(requirementWithoutReceipt.ok, false);
    const requirementReceipt = exactReceipt(native, native, requirementHead, ["requirement:ANP-CORE"]);
    const requirementAuthorized = evaluate(native, requirementHead, ["ANP-CORE"], requirementProvider, [requirementReceipt]);
    assert.equal(requirementAuthorized.ok, true, requirementAuthorized.reasons.join(" | "));
    const staleRequirementReceipt = exactReceipt(native, native, "e".repeat(40), ["requirement:ANP-CORE"]);
    const requirementStale = evaluate(native, requirementHead, ["ANP-CORE"], requirementProvider, [staleRequirementReceipt]);
    assert.equal(requirementStale.ok, false);

    resetScenario(fixture, native, "package-positive");
    const packageJson = JSON.parse(readFileSync(join(fixture, "package.json"), "utf8"));
    const packageLock = JSON.parse(readFileSync(join(fixture, "package-lock.json"), "utf8"));
    packageJson.version = "0.5.9";
    packageLock.version = "0.5.9";
    packageLock.packages[""].version = "0.5.9";
    writeJson(join(fixture, "package.json"), packageJson);
    writeJson(join(fixture, "package-lock.json"), packageLock);
    const packageHead = commitAll(fixture, "valid package metadata change");
    const packageProvider = bundleResult(native, packageHead);
    assert.equal(packageProvider.result.ok, true, packageProvider.result.reasons.join(" | "));
    assert.ok(packageProvider.result.authenticatedProviderGrants.length >= 3);
    const packageNoEvidence = pipeline.evaluateRepoGuardNativeBlockingSnapshot({
      repository: REPOSITORY,
      repositoryRoot: fixture,
      trustedAuthorityBaseRevision: native,
      baseRevision: native,
      headRevision: packageHead,
      workIntent: { id: "package-no-evidence", addresses: ["ANP-PACKAGE"] },
      trustedReceipts: [],
      protectedResources: packageProvider.result.protectedResources,
      evidenceFacts: [],
      observationFacts: [],
      authenticatedProviderGrants: [],
    });
    assert.equal(packageNoEvidence.ok, false);
    assert.ok(packageNoEvidence.reasons.some((reason) => reason.includes("missing_evidence:ANP-PACKAGE")));
    const packagePositive = evaluate(native, packageHead, ["ANP-PACKAGE"], packageProvider);
    assert.equal(packagePositive.ok, true, packagePositive.reasons.join(" | "));

    resetScenario(fixture, native, "package-invalid");
    const badPackage = JSON.parse(readFileSync(join(fixture, "package.json"), "utf8"));
    badPackage.version = "0.5.9";
    writeJson(join(fixture, "package.json"), badPackage);
    const badPackageHead = commitAll(fixture, "inconsistent package metadata");
    const badPackageProvider = bundleResult(native, badPackageHead);
    assert.equal(badPackageProvider.result.ok, true);
    assert.ok(badPackageProvider.result.evidenceFacts.some((fact) => fact.status === "fail"));
    const badPackageEvaluation = evaluate(native, badPackageHead, ["ANP-PACKAGE"], badPackageProvider);
    assert.equal(badPackageEvaluation.ok, false);

    resetScenario(fixture, native, "readme-invalid");
    writeFileSync(join(fixture, "README.md"), "# Лаборатория\n\nThis English sentence is invalid prose.\n");
    const readmeHead = commitAll(fixture, "invalid README language");
    const readmeProvider = bundleResult(native, readmeHead);
    assert.ok(readmeProvider.result.evidenceFacts.some((fact) => fact.status === "fail"));
    const readmeEvaluation = evaluate(native, readmeHead, ["ANP-README"], readmeProvider);
    assert.equal(readmeEvaluation.ok, false);

    resetScenario(fixture, native, "legacy-budget-removed");
    writeFileSync(join(fixture, "src", "model.js"),
      readFileSync(join(fixture, "src", "model.js"), "utf8") +
      "\n" + Array.from({ length: 2601 }, (_, index) => "// допустимое изменение " + index).join("\n") + "\n");
    const largeHead = commitAll(fixture, "large but justified source change");
    const largeProvider = bundleResult(native, largeHead);
    const largeEvaluation = evaluate(native, largeHead, ["ANP-CORE"], largeProvider);
    assert.equal(largeEvaluation.ok, true, largeEvaluation.reasons.join(" | "));

    resetScenario(fixture, native, "protected-workflow");
    writeFileSync(join(fixture, TRUSTED_WORKFLOW),
      readFileSync(join(fixture, TRUSTED_WORKFLOW), "utf8") + "\n# authorized test-only comment\n");
    const protectedHead = commitAll(fixture, "protected workflow change");
    const normalProvider = bundleResult(native, protectedHead, "pull_request_target");
    const refreshProvider = bundleResult(native, protectedHead, "issues");
    assert.equal(normalProvider.result.ok, true, normalProvider.result.reasons.join(" | "));
    assert.equal(refreshProvider.result.ok, true, refreshProvider.result.reasons.join(" | "));
    assert.deepEqual(refreshProvider.result.protectedResources, normalProvider.result.protectedResources);
    assert.ok(normalProvider.result.protectedResources.includes(TRUSTED_WORKFLOW));
    assert.ok(normalProvider.result.protectedResources.includes(PROVIDER_SOURCE));
    assert.equal(refreshProvider.result.authenticatedProviderGrants.length, normalProvider.result.authenticatedProviderGrants.length);
    assert.deepEqual(refreshProvider.result.evidenceFacts, normalProvider.result.evidenceFacts);
    assert.deepEqual(refreshProvider.result.observationFacts, normalProvider.result.observationFacts);

    const protectedNormalNoReceipt = evaluate(native, protectedHead, ["ANP-GOVERNANCE"], normalProvider);
    const protectedRefreshNoReceipt = evaluate(native, protectedHead, ["ANP-GOVERNANCE"], refreshProvider);
    assert.equal(protectedNormalNoReceipt.ok, false);
    assert.equal(protectedRefreshNoReceipt.ok, false);
    assert.ok(protectedNormalNoReceipt.reasons.some((reason) => reason.includes("missing_authority:resource:" + TRUSTED_WORKFLOW)));
    assert.deepEqual(protectedRefreshNoReceipt.reasons, protectedNormalNoReceipt.reasons);

    const wrongResourceReceipt = exactReceipt(native, native, protectedHead, ["resource:.github/workflows/repo-guard.yml"]);
    assert.equal(evaluate(native, protectedHead, ["ANP-GOVERNANCE"], normalProvider, [wrongResourceReceipt]).ok, false);

    const staleProtectedReceipt = exactReceipt(native, native, "d".repeat(40), ["resource:" + TRUSTED_WORKFLOW]);
    assert.equal(evaluate(native, protectedHead, ["ANP-GOVERNANCE"], normalProvider, [staleProtectedReceipt]).ok, false);

    const rootOnlyReceipt = exactReceipt(native, native, protectedHead, [migration.requiredPermissions[0]]);
    assert.equal(evaluate(native, protectedHead, ["ANP-GOVERNANCE"], normalProvider, [rootOnlyReceipt]).ok, false);

    const exactProtectedReceipt = exactReceipt(native, native, protectedHead, ["resource:" + TRUSTED_WORKFLOW]);
    const protectedNormalExact = evaluate(native, protectedHead, ["ANP-GOVERNANCE"], normalProvider, [exactProtectedReceipt]);
    const protectedRefreshExact = evaluate(native, protectedHead, ["ANP-GOVERNANCE"], refreshProvider, [exactProtectedReceipt]);
    assert.equal(protectedNormalExact.ok, true, protectedNormalExact.reasons.join(" | "));
    assert.equal(protectedRefreshExact.ok, true, protectedRefreshExact.reasons.join(" | "));
    assert.equal(protectedNormalExact.providerCapabilityMode, true);
    assert.equal(protectedRefreshExact.providerCapabilityMode, true);

    const trustWithoutDomain = pipeline.evaluateRepoGuardNativeBlockingSnapshot({
      repository: REPOSITORY,
      repositoryRoot: fixture,
      trustedAuthorityBaseRevision: native,
      baseRevision: native,
      headRevision: protectedHead,
      workIntent: { id: "trust-no-domain", addresses: ["ANP-GOVERNANCE"] },
      trustedReceipts: [exactProtectedReceipt],
      protectedResources: [TRUSTED_WORKFLOW, PROVIDER_SOURCE],
      evidenceFacts: [],
      observationFacts: [],
      authenticatedProviderGrants: [],
    });
    assert.equal(trustWithoutDomain.ok, false);
    assert.ok(trustWithoutDomain.reasons.some((reason) => reason.includes("missing_evidence:ANP-GOVERNANCE")));

    const legacyTree = git(fixture, "rev-parse", legacy + "^{tree}");
    const commitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "Rollback Test",
      GIT_AUTHOR_EMAIL: "rollback@example.test",
      GIT_COMMITTER_NAME: "Rollback Test",
      GIT_COMMITTER_EMAIL: "rollback@example.test",
    };
    const rollbackHead = run("git", ["commit-tree", legacyTree, "-p", native, "-m", "exact rollback"], fixture, commitEnv);
    const rollbackNoTrust = pipeline.evaluateNativeRollbackSnapshot({
      repository: REPOSITORY,
      repositoryRoot: fixture,
      trustedAuthorityBaseRevision: native,
      baseRevision: native,
      headRevision: rollbackHead,
      trustedRootReceipt: null,
    });
    assert.equal(rollbackNoTrust.candidateReady, true, rollbackNoTrust.reasons.join(" | "));
    assert.equal(rollbackNoTrust.exactLegacyTreeRestored, true);
    assert.equal(rollbackNoTrust.ok, false);
    assert.equal(rollbackNoTrust.requiredPermissions.length, 9);

    const rollbackReceipt = {
      repository: REPOSITORY,
      authorityBaseRevision: native,
      baseRevision: native,
      headRevision: rollbackHead,
      permissions: rollbackNoTrust.requiredPermissions,
    };
    const rollback = pipeline.evaluateNativeRollbackSnapshot({
      repository: REPOSITORY,
      repositoryRoot: fixture,
      trustedAuthorityBaseRevision: native,
      baseRevision: native,
      headRevision: rollbackHead,
      trustedRootReceipt: rollbackReceipt,
    });
    assert.equal(rollback.ok, true, rollback.reasons.join(" | "));

    resetScenario(fixture, legacy, "wrong-legacy-tree");
    rmSync(join(fixture, "PORTFOLIO.md"));
    const wrongLegacyState = commitAll(fixture, "arbitrary legacy state");
    const wrongLegacyTree = git(fixture, "rev-parse", wrongLegacyState + "^{tree}");
    const arbitraryRollbackHead = run("git",
      ["commit-tree", wrongLegacyTree, "-p", native, "-m", "arbitrary rollback"], fixture, commitEnv);
    const arbitraryRollback = pipeline.evaluateNativeRollbackSnapshot({
      repository: REPOSITORY,
      repositoryRoot: fixture,
      trustedAuthorityBaseRevision: native,
      baseRevision: native,
      headRevision: arbitraryRollbackHead,
      trustedRootReceipt: {
        ...rollbackReceipt,
        headRevision: arbitraryRollbackHead,
      },
    });
    assert.equal(arbitraryRollback.ok, false);
    assert.equal(arbitraryRollback.exactLegacyTreeRestored, false);

    process.stdout.write([
      "ANUM_PARSER_NATIVE_PILOT_MATRIX=GREEN",
      "requirements=9",
      "tracked=" + nativeTracked,
      "J2=9/9",
      "J1=" + nativeTracked + "/" + nativeTracked,
      "providerCapabilityMode=true",
      "zeroGrantOrdinary=true",
      "sameTransitionSameSecurityVerdict=true",
      "rollbackExact=true",
    ].join(" ") + "\n");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    if (repoGuardRoot) rmSync(repoGuardRoot, { recursive: true, force: true });
  }
});
