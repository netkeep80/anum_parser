import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export const PROVIDER_FORMAT = "repo-guard/provider-bundle-v1";
export const PROVIDER_SOURCE = "scripts/repo-guard-provider.mjs";
export const PACKAGE_REQUIREMENT = "ANP-PACKAGE";
export const README_REQUIREMENT = "ANP-README";
export const GOVERNANCE_REQUIREMENT = "ANP-GOVERNANCE";
export const PACKAGE_EVIDENCE_KEY = "domain:package-metadata-consistency";
export const README_EVIDENCE_KEY = "domain:readme-russian-first";
export const GOVERNANCE_EVIDENCE_KEY = "domain:repo-guard-integration";
export const REPO_GUARD_SHA = "cdf6a8938ff54d6e94eb200d8233fef1f317f254";
export const GOVERNANCE_PATHS = Object.freeze([
  ".github/workflows/repo-guard.yml",
  ".github/workflows/trusted-enforcement.yml",
  PROVIDER_SOURCE,
]);

const FULL_SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const NATIVE_REQUIREMENT = /^requirements\/.*\.rg\.(?:yaml|json)$/;
const README_ALLOWED_LATIN = new Set(["API", "ASCII", "CI", "CLI", "Git", "GitHub", "JSON", "Python", "UTF"]);

function git(args, cwd = process.cwd()) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  }).trimEnd();
}

function readAt(revision, path, cwd = process.cwd()) {
  return git(["show", `${revision}:${path}`], cwd);
}

function parseJsonAt(revision, path, cwd = process.cwd()) {
  return JSON.parse(readAt(revision, path, cwd));
}

export function parseSemver(value) {
  if (typeof value !== "string") return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (!match) return null;
  const prerelease = match[4] === undefined ? [] : match[4].split(".").map((part) => {
    if (/^\d+$/.test(part)) {
      if (part.length > 1 && part.startsWith("0")) return null;
      return Number(part);
    }
    return part;
  });
  if (prerelease.some((part) => part === null)) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= left.length) return -1;
    if (index >= right.length) return 1;
    const a = left[index], b = right[index];
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function compareSemver(left, right) {
  const a = parseSemver(left), b = parseSemver(right);
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

function markdownProseLines(content) {
  const lines = String(content || "").split(/\r?\n/);
  const prose = [];
  let fence = null;
  for (const [offset, line] of lines.entries()) {
    if (!fence) {
      const opening = line.match(/^([ \t]*)(`{3,}|~{3,})(.*)$/);
      if (opening) {
        fence = { marker: opening[2][0], length: opening[2].length };
        continue;
      }
      prose.push({ line: offset + 1, text: line });
      continue;
    }
    const closing = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
    if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) fence = null;
  }
  return prose;
}

function stripDeclaredForeignLanguageSpans(line, targetLanguage = "ru") {
  const target = targetLanguage.toLowerCase();
  return line.replace(/<span\b([^>]*)>(.*?)<\/span\s*>/gi, (whole, attributes) => {
    const match = attributes.match(/\blang\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const language = (match?.[1] || match?.[2] || "").toLowerCase();
    if (!language) return whole;
    return language === target || language.startsWith(target + "-") ? whole : "";
  });
}

function stripMarkdownInline(line) {
  return line
    .replace(/<!--.*?-->/g, "")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, "");
}

export function evaluateRussianFirstMarkdown(content) {
  const violations = [];
  for (const prose of markdownProseLines(content)) {
    const line = stripMarkdownInline(stripDeclaredForeignLanguageSpans(prose.text, "ru"));
    const latin = [...line.matchAll(/(?<![\w])([A-Za-z][A-Za-z-]{2,})(?![\w])/g)]
      .map((match) => match[1])
      .filter((word) => !README_ALLOWED_LATIN.has(word));
    const hasCyrillic = /[А-Яа-яЁё]{3,}/.test(line);
    if (latin.length > 1 || (latin.length > 0 && !hasCyrillic)) {
      violations.push({ line: prose.line, words: latin });
    }
  }
  return { ok: violations.length === 0, violations };
}

export function changedPaths(baseRevision, headRevision, cwd = process.cwd()) {
  const raw = execFileSync("git", ["diff", "--name-only", "-z", baseRevision, headRevision, "--"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });
  return raw.split("\0").filter(Boolean).sort();
}

export function changedLines(baseRevision, headRevision, path, cwd = process.cwd()) {
  const raw = git(["diff", "--numstat", baseRevision, headRevision, "--", path], cwd);
  if (!raw) return 0;
  let total = 0;
  for (const line of raw.split("\n")) {
    const [added, deleted] = line.split("\t");
    if (!/^\d+$/.test(added) || !/^\d+$/.test(deleted))
      throw new Error(`cannot derive text changed_lines for ${path}`);
    total += Number(added) + Number(deleted);
  }
  assert.ok(Number.isSafeInteger(total));
  return total;
}

export function hasNativeRequirements(revision, cwd = process.cwd()) {
  const raw = git(["ls-tree", "-r", "--name-only", revision, "--", "requirements"], cwd);
  return raw.split("\n").filter(Boolean).some((path) => NATIVE_REQUIREMENT.test(path));
}

export function providerTransition(eventBaseRevision, eventHeadRevision, cwd = process.cwd()) {
  const baseNative = hasNativeRequirements(eventBaseRevision, cwd);
  const headNative = hasNativeRequirements(eventHeadRevision, cwd);
  if (!baseNative && headNative) {
    return {
      authorityBaseRevision: eventHeadRevision,
      baseRevision: eventHeadRevision,
      headRevision: eventHeadRevision,
    };
  }
  return {
    authorityBaseRevision: eventBaseRevision,
    baseRevision: eventBaseRevision,
    headRevision: eventHeadRevision,
  };
}

export function evaluatePackageMetadata(baseRevision, headRevision, touchedPaths, cwd = process.cwd()) {
  const touched = new Set(touchedPaths);
  const subjectPaths = ["package.json", "package-lock.json"].filter((path) => touched.has(path));
  const reasons = [];
  try {
    if (subjectPaths.length !== 2) reasons.push("package_and_lock_must_change_together");
    const basePackage = parseJsonAt(baseRevision, "package.json", cwd);
    const headPackage = parseJsonAt(headRevision, "package.json", cwd);
    const headLock = parseJsonAt(headRevision, "package-lock.json", cwd);
    const baseVersion = basePackage?.version, headVersion = headPackage?.version;
    if (parseSemver(baseVersion) === null) reasons.push("base_version_not_semver");
    if (parseSemver(headVersion) === null) reasons.push("head_version_not_semver");
    const comparison = compareSemver(headVersion, baseVersion);
    if (comparison === null || comparison <= 0) reasons.push("version_must_strictly_advance");
    if (headLock?.version !== headVersion) reasons.push("lock_root_version_mismatch");
    if (headLock?.packages?.[""]?.version !== headVersion) reasons.push("lock_package_version_mismatch");
  } catch (error) {
    reasons.push("package_metadata_unreadable:" + (error instanceof Error ? error.message : String(error)));
  }
  return { ok: reasons.length === 0, subjectPaths, reasons };
}

export function evaluateReadme(headRevision, cwd = process.cwd()) {
  try {
    return evaluateRussianFirstMarkdown(readAt(headRevision, "README.md", cwd));
  } catch (error) {
    return { ok: false, violations: [{ line: 0, words: ["README_UNREADABLE"], error: String(error) }] };
  }
}

export function evaluateRepoGuardIntegration(headRevision, cwd = process.cwd()) {
  const reasons = [];
  try {
    const ordinary = readAt(headRevision, ".github/workflows/repo-guard.yml", cwd);
    const trusted = readAt(headRevision, ".github/workflows/trusted-enforcement.yml", cwd);
    const exactUse = "uses: netkeep80/repo-guard@" + REPO_GUARD_SHA;
    if (!ordinary.includes(exactUse)) reasons.push("ordinary_repo_guard_pin_mismatch");
    if (!/\bmode:\s*check-pr\b/.test(ordinary)) reasons.push("ordinary_repo_guard_mode_mismatch");
    if (!/\benforcement:\s*blocking\b/.test(ordinary)) reasons.push("ordinary_repo_guard_not_blocking");

    const trustedUses = trusted.split(exactUse).length - 1;
    if (trustedUses < 2) reasons.push("trusted_repo_guard_pin_missing");
    if (!/pull_request_target:/.test(trusted)) reasons.push("trusted_pull_request_target_missing");
    if (!/issues:\s*\n\s*types:\s*\[edited\]/.test(trusted)) reasons.push("linked_issue_refresh_missing");
    if ((trusted.match(/authenticated-provider-bundle:/g) || []).length < 2)
      reasons.push("authenticated_provider_bundle_not_wired_for_both_paths");
    if ((trusted.match(/scripts\/repo-guard-provider\.mjs/g) || []).length < 2)
      reasons.push("accepted_provider_not_wired_for_both_paths");
    if (!/RG_EVENT_PATH:/.test(trusted)) reasons.push("refresh_event_projection_missing");
    if (!trusted.includes("actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1"))
      reasons.push("dedicated_status_producer_pin_mismatch");
  } catch (error) {
    reasons.push("repo_guard_integration_unreadable:" + (error instanceof Error ? error.message : String(error)));
  }
  return { ok: reasons.length === 0, reasons };
}

export function buildProviderBundle({
  repository,
  eventBaseRevision,
  eventHeadRevision,
  repositoryRoot = process.cwd(),
}) {
  if (!REPOSITORY.test(repository)) throw new Error("invalid repository identity");
  if (!FULL_SHA.test(eventBaseRevision) || !FULL_SHA.test(eventHeadRevision))
    throw new Error("BASE and HEAD must be exact lowercase 40-hex revisions");

  const touchedPaths = changedPaths(eventBaseRevision, eventHeadRevision, repositoryRoot);
  const touched = new Set(touchedPaths);
  const transition = providerTransition(eventBaseRevision, eventHeadRevision, repositoryRoot);
  const claims = [];

  const packageTouched = touched.has("package.json") || touched.has("package-lock.json");
  if (packageTouched) {
    const result = evaluatePackageMetadata(eventBaseRevision, eventHeadRevision, touchedPaths, repositoryRoot);
    claims.push({
      boundary: "domain",
      class: "domain",
      key: PACKAGE_EVIDENCE_KEY,
      requirementId: PACKAGE_REQUIREMENT,
      subjectPaths: result.subjectPaths,
      status: result.ok ? "pass" : "fail",
    });
    for (const path of result.subjectPaths) {
      claims.push({
        boundary: "observation",
        metric: "git.changed_lines",
        path,
        value: changedLines(eventBaseRevision, eventHeadRevision, path, repositoryRoot),
      });
    }
  }

  if (touched.has("README.md")) {
    const result = evaluateReadme(eventHeadRevision, repositoryRoot);
    claims.push({
      boundary: "domain",
      class: "domain",
      key: README_EVIDENCE_KEY,
      requirementId: README_REQUIREMENT,
      subjectPaths: ["README.md"],
      status: result.ok ? "pass" : "fail",
    });
    claims.push({
      boundary: "observation",
      metric: "git.changed_lines",
      path: "README.md",
      value: changedLines(eventBaseRevision, eventHeadRevision, "README.md", repositoryRoot),
    });
  }

  const governanceTouched = GOVERNANCE_PATHS.filter((path) => touched.has(path));
  if (governanceTouched.length > 0) {
    const result = evaluateRepoGuardIntegration(eventHeadRevision, repositoryRoot);
    claims.push({
      boundary: "domain",
      class: "domain",
      key: GOVERNANCE_EVIDENCE_KEY,
      requirementId: GOVERNANCE_REQUIREMENT,
      subjectPaths: governanceTouched,
      status: result.ok ? "pass" : "fail",
    });
    for (const path of governanceTouched) {
      claims.push({
        boundary: "observation",
        metric: "git.changed_lines",
        path,
        value: changedLines(eventBaseRevision, eventHeadRevision, path, repositoryRoot),
      });
    }
  }

  return {
    format: PROVIDER_FORMAT,
    transition: {
      repository,
      ...transition,
    },
    claims,
    trust: {
      repository,
      authorityBaseRevision: eventBaseRevision,
      protectedResources: [PROVIDER_SOURCE],
    },
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --name value pairs");
    values[key.slice(2)] = value;
  }
  return values;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const repository = args.repository || process.env.GITHUB_REPOSITORY || "";
  const eventBaseRevision = args.base || "";
  const eventHeadRevision = args.head || "";
  const output = args.output || "";
  if (!isAbsolute(output)) throw new Error("--output must be an absolute path below RUNNER_TEMP");
  const runnerTemp = process.env.RUNNER_TEMP || "";
  if (!runnerTemp || !isAbsolute(runnerTemp) || !(output === runnerTemp || output.startsWith(runnerTemp.replace(/[\\/]$/, "") + "/")))
    throw new Error("--output must be below RUNNER_TEMP");
  const bundle = buildProviderBundle({ repository, eventBaseRevision, eventHeadRevision });
  writeFileSync(output, JSON.stringify(bundle, null, 2) + "\n", "utf8");
  process.stdout.write(output + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
