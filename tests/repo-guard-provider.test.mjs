import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildProviderBundle,
  compareSemver,
  evaluateRussianFirstMarkdown,
  PACKAGE_EVIDENCE_KEY,
  README_EVIDENCE_KEY,
  GOVERNANCE_EVIDENCE_KEY,
  REPO_GUARD_SHA,
  PROVIDER_SOURCE,
} from "../scripts/repo-guard-provider.mjs";

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
}

function writePackage(root, version, lockVersion = version, lockPackageVersion = version) {
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "fixture",
    version,
    private: true,
    type: "module",
  }, null, 2) + "\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({
    name: "fixture",
    version: lockVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "fixture",
        version: lockPackageVersion,
      },
    },
  }, null, 2) + "\n");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "anum-parser-provider-"));
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "provider@example.test");
  git(root, "config", "user.name", "Provider Test");
  writePackage(root, "0.5.7");
  writeFileSync(join(root, "README.md"), "# Лаборатория\n\nЭто проверяемое описание API.\n");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.js"), "export const a = 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-m", "base");
  return root;
}

function commit(root, message) {
  git(root, "add", "-A");
  git(root, "commit", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

describe("#135 accepted provider adapter", () => {
  it("uses strict SemVer precedence for package authority", () => {
    assert.equal(compareSemver("0.5.8", "0.5.7"), 1);
    assert.equal(compareSemver("1.0.0", "1.0.0-rc.1"), 1);
    assert.equal(compareSemver("1.0.0-rc.2", "1.0.0-rc.10"), -1);
    assert.equal(compareSemver("1.0", "0.5.7"), null);
  });

  it("preserves the accepted Russian-first Markdown rule and ignores fenced code", () => {
    assert.equal(evaluateRussianFirstMarkdown("# Заголовок\n\nОписание API на русском.\n").ok, true);
    assert.equal(evaluateRussianFirstMarkdown("# Заголовок\n\nThis English sentence is prose.\n").ok, false);
    assert.equal(evaluateRussianFirstMarkdown("# Заголовок\n\n\`\`\`js\nconst englishWordsAreCode = true;\n\`\`\`\n").ok, true);
  });

  it("emits exact post-cutover tuple, authenticated DOMAIN/OBSERVATION claims and independent TRUST", () => {
    const root = fixture();
    try {
      const base = git(root, "rev-parse", "HEAD");
      writePackage(root, "0.5.8");
      mkdirSync(join(root, "requirements"), { recursive: true });
      writeFileSync(join(root, "requirements", "ANP-CORE.rg.yaml"), [
        "format: repo-guard/requirement-v1",
        "id: ANP-CORE",
        'normative: "fixture"',
        "relations:",
        "  - predicates: [implemented_by]",
        "    target:",
        "      kind: artifact",
        '      path: "src/a.js"',
        "",
      ].join("\n"));
      const head = commit(root, "native candidate");
      const bundle = buildProviderBundle({
        repository: "netkeep80/anum_parser",
        eventBaseRevision: base,
        eventHeadRevision: head,
        repositoryRoot: root,
      });

      assert.deepEqual(bundle.transition, {
        repository: "netkeep80/anum_parser",
        authorityBaseRevision: head,
        baseRevision: head,
        headRevision: head,
      });
      assert.deepEqual(bundle.trust, {
        repository: "netkeep80/anum_parser",
        authorityBaseRevision: base,
        protectedResources: [PROVIDER_SOURCE],
      });
      const domain = bundle.claims.find((claim) => claim.boundary === "domain" && claim.key === PACKAGE_EVIDENCE_KEY);
      assert.equal(domain?.status, "pass");
      assert.deepEqual(domain?.subjectPaths, ["package.json", "package-lock.json"]);
      assert.equal(bundle.claims.filter((claim) => claim.boundary === "observation").length, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects partial package metadata transitions instead of using cochange ceremony", () => {
    const root = fixture();
    try {
      const base = git(root, "rev-parse", "HEAD");
      const manifest = JSON.parse(execFileSync("git", ["show", base + ":package.json"], { cwd: root, encoding: "utf8" }));
      manifest.version = "0.5.8";
      writeFileSync(join(root, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
      const head = commit(root, "partial package metadata");
      const bundle = buildProviderBundle({
        repository: "netkeep80/anum_parser",
        eventBaseRevision: base,
        eventHeadRevision: head,
        repositoryRoot: root,
      });
      const domain = bundle.claims.find((claim) => claim.boundary === "domain" && claim.key === PACKAGE_EVIDENCE_KEY);
      assert.equal(domain?.status, "fail");
      assert.deepEqual(domain?.subjectPaths, ["package.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports README Russian-first failure through DOMAIN and changed-lines through OBSERVATION", () => {
    const root = fixture();
    try {
      const base = git(root, "rev-parse", "HEAD");
      writeFileSync(join(root, "README.md"), "# Лаборатория\n\nThis English sentence is prose.\n");
      const head = commit(root, "invalid readme");
      const bundle = buildProviderBundle({
        repository: "netkeep80/anum_parser",
        eventBaseRevision: base,
        eventHeadRevision: head,
        repositoryRoot: root,
      });
      const domain = bundle.claims.find((claim) => claim.boundary === "domain" && claim.key === README_EVIDENCE_KEY);
      assert.equal(domain?.status, "fail");
      const observation = bundle.claims.find((claim) => claim.boundary === "observation" && claim.path === "README.md");
      assert.equal(typeof observation?.value, "number");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("emits authenticated governance evidence only from exact accepted integration", () => {
    const root = fixture();
    try {
      mkdirSync(join(root, ".github", "workflows"), { recursive: true });
      mkdirSync(join(root, "scripts"), { recursive: true });
      writeFileSync(join(root, ".github", "workflows", "repo-guard.yml"), [
        "jobs:",
        "  policy-check:",
        "    steps:",
        "      - uses: actions/checkout@v6",
        "      - name: Run repo-guard",
        `        uses: netkeep80/repo-guard@${REPO_GUARD_SHA}`,
        "        with:",
        "          mode: check-pr",
        "          enforcement: blocking",
        "",
      ].join("\n"));
      writeFileSync(join(root, ".github", "workflows", "trusted-enforcement.yml"), [
        "on:",
        "  pull_request_target:",
        "  issues:",
        "    types: [edited]",
        "jobs:",
        "  trusted:",
        "    steps:",
        `      - uses: netkeep80/repo-guard@${REPO_GUARD_SHA}`,
        "        with:",
        "          authenticated-provider-bundle: bundle-one",
        "      - run: node scripts/repo-guard-provider.mjs",
        `      - uses: netkeep80/repo-guard@${REPO_GUARD_SHA}`,
        "        with:",
        "          authenticated-provider-bundle: bundle-two",
        "      - run: node scripts/repo-guard-provider.mjs",
        "        env:",
        "          RG_EVENT_PATH: refresh.json",
        "      - uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
        "",
      ].join("\n"));
      writeFileSync(join(root, "scripts", "repo-guard-provider.mjs"), "export const accepted = true;\n");
      git(root, "add", "-A");
      git(root, "commit", "-m", "governance base");
      const base = git(root, "rev-parse", "HEAD");

      writeFileSync(join(root, ".github", "workflows", "repo-guard.yml"),
        execFileSync("git", ["show", base + ":.github/workflows/repo-guard.yml"], { cwd: root, encoding: "utf8" }) + "# touch\n");
      const head = commit(root, "governance touch");
      const bundle = buildProviderBundle({
        repository: "netkeep80/anum_parser",
        eventBaseRevision: base,
        eventHeadRevision: head,
        repositoryRoot: root,
      });
      const domain = bundle.claims.find((claim) => claim.boundary === "domain" && claim.key === GOVERNANCE_EVIDENCE_KEY);
      assert.equal(domain?.status, "pass");
      assert.deepEqual(domain?.subjectPaths, [".github/workflows/repo-guard.yml"]);

      git(root, "checkout", "-q", "-B", "bad", base);
      const bad = execFileSync("git", ["show", base + ":.github/workflows/repo-guard.yml"], { cwd: root, encoding: "utf8" })
        .replace(REPO_GUARD_SHA, "a".repeat(40));
      writeFileSync(join(root, ".github", "workflows", "repo-guard.yml"), bad);
      const badHead = commit(root, "break exact pin");
      const invalid = buildProviderBundle({
        repository: "netkeep80/anum_parser",
        eventBaseRevision: base,
        eventHeadRevision: badHead,
        repositoryRoot: root,
      });
      const invalidDomain = invalid.claims.find((claim) => claim.boundary === "domain" && claim.key === GOVERNANCE_EVIDENCE_KEY);
      assert.equal(invalidDomain?.status, "fail");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps ordinary native transitions in explicit zero-grant provider mode", () => {
    const root = fixture();
    try {
      mkdirSync(join(root, "requirements"), { recursive: true });
      writeFileSync(join(root, "requirements", "ANP-CORE.rg.yaml"), [
        "format: repo-guard/requirement-v1",
        "id: ANP-CORE",
        'normative: "fixture"',
        "relations:",
        "  - predicates: [implemented_by]",
        "    target:",
        "      kind: artifact",
        '      path: "src/a.js"',
        "",
      ].join("\n"));
      const base = commit(root, "native base");
      writeFileSync(join(root, "src", "a.js"), "export const a = 2;\n");
      const head = commit(root, "ordinary native change");
      const bundle = buildProviderBundle({
        repository: "netkeep80/anum_parser",
        eventBaseRevision: base,
        eventHeadRevision: head,
        repositoryRoot: root,
      });
      assert.deepEqual(bundle.transition, {
        repository: "netkeep80/anum_parser",
        authorityBaseRevision: base,
        baseRevision: base,
        headRevision: head,
      });
      assert.deepEqual(bundle.claims, []);
      assert.deepEqual(bundle.trust.protectedResources, [PROVIDER_SOURCE]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
