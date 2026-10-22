import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Consumer-owned domain checks. RepoGuard core delegates execution to ordinary CI.
const README_ALLOWED_LATIN = new Set(["API","ASCII","CI","CLI","Git","GitHub","JSON","Python","UTF"]);
const SHA40 = /^[a-f0-9]{40}$/;
function git(args,cwd=process.cwd()) {
  return execFileSync("git",args,{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"],maxBuffer:20*1024*1024}).trimEnd();
}
function readAt(revision,path,cwd=process.cwd()) { return git(["show",revision+":"+path],cwd); }
function parseJsonAt(revision,path,cwd=process.cwd()) { return JSON.parse(readAt(revision,path,cwd)); }

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
    if (comparison === null || comparison < 0 || (headVersion !== baseVersion && comparison === 0)) reasons.push("version_must_strictly_advance");
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

export function checkDomain(base,head,cwd=process.cwd()) {
  const reasons=[];
  if(!SHA40.test(base)||!SHA40.test(head))return {ok:false,reasons:["not_exact_sha"]};
  let changed=[];
  try {
    changed=changedPaths(base,head,cwd);
    if(changed.includes("package.json")||changed.includes("package-lock.json")) {
      reasons.push(...evaluatePackageMetadata(base,head,changed,cwd).reasons);
    }
    const language=evaluateReadme(head,cwd);
    if(!language.ok)reasons.push(...language.violations.map(v=>"readme_russian_first:"+v.line+":"+v.words.join(",")));
    const pin=parseJsonAt(head,".repo-guard/compiler-pin.json",cwd);
    if(pin.repository!=="netkeep80/repo-guard"||!SHA40.test(pin.sha)||Object.keys(pin).sort().join(",")!=="repository,sha")
      reasons.push("invalid_exact_compiler_pin");
    const tracked=new Set(git(["ls-tree","-r","--name-only",head],cwd).split("\n").filter(Boolean));
    if(tracked.has("repo-policy.json")||tracked.has(".github/workflows/trusted-enforcement.yml"))
      reasons.push("legacy_policy_or_trusted_workflow_still_tracked");
    const workflow=readAt(head,".github/workflows/repo-guard.yml",cwd);
    if(!workflow.includes("repo-guard-native")||!workflow.includes("compiler-pin.json")||
       !workflow.includes(" check --base ")||!workflow.includes(" --head ")||
       /trusted-service|authenticated-provider-bundle|TRUSTED_ENFORCEMENT_APP|GH_TOKEN/.test(workflow))
      reasons.push("compiler_only_workflow_contract_missing");
  } catch(error) { reasons.push("domain_check_unreadable:"+String(error.message||error)); }
  return {ok:reasons.length===0,base,head,changed,reasons};
}
const running=process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url);
if(running){
  const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
  const result=checkDomain(arg("--base"),arg("--head"));
  console.log(JSON.stringify(result,null,2));
  if(!result.ok)process.exitCode=1;
}
