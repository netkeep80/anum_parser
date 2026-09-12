# Repo-guard version governance and CI compression design

Issue: #121  
Upstream acceptance gate: `netkeep80/repo-guard#381`

## 1. Purpose

Use `netkeep80/anum_parser` as a real, merge-to-main external consumer of the accepted repo-guard C3.10 candidate and prove that the compressed generic relation architecture provides concrete repository-level value.

This change has two coupled outcomes:

1. repository governance becomes stronger and simpler: every PR must advance the application version, package metadata must remain coherent, and the repo-guard workflow protects its own critical configuration through generic document relations;
2. CI/CD becomes cheaper and faster without deleting coverage or introducing a second build architecture.

The work must produce falsifiable RED -> GREEN evidence and measured before/after results.

## 2. Exact starting authority

At design time:

```text
anum_parser main = 8181a444ca96159b18b50f8ec93d1d323d3acdf9
package.json.version = 0.5.0
package-lock.json root package version = 0.5.0
repo-guard workflow pin = 03e24a781f024ab1c91e79678737fe4ded743d48
accepted repo-guard candidate = e5b9063c9d1c9e05404ec32b78ca005c278839ce
open PRs = none
```

GitHub remains the source of truth. Re-read live state before every write, lifecycle transition and merge decision.

## 3. Version authority

`package.json` is the single application-version authority.

The existing runtime/Pages path is retained:

```text
package.json:/version
  -> scripts/build-static-site.mjs copies package.json into _site
  -> GitHub Pages deploys _site
  -> src/app.js fetches ./package.json with cache: no-store
  -> UI renders vX.Y.Z
  -> document.title includes the same version
```

No `VERSION` file, generated version module, duplicated HTML literal or workflow-owned version is introduced.

`package-lock.json` is metadata that must agree with the authoritative `package.json`; it is not a second authority.

## 4. Every-PR version invariant

The invariant enforced on ordinary PRs is:

```text
HEAD package.json:/version > BASE package.json:/version
comparator = semver
```

This means every mergeable PR must contain an application-version increase.

The rule intentionally does not require `patch == base.patch + 1`. Repo-guard's final generic relation algebra already contains `scalar_strictly_greater` with semver comparison. Adding an `anum_parser`-specific or speculative `next_patch` primitive would weaken the Architecture Compression 3.0 result rather than demonstrate it.

The initial migration PR advances:

```text
0.5.0 -> 0.5.1
```

Future PRs may advance patch, minor or major semver as appropriate, but cannot keep or decrease the version.

## 5. Package/lock coherence

Define named JSON documents against HEAD:

```text
package-head      -> package.json
package-lock-head -> package-lock.json
```

Enforce:

```text
package-head:/version == package-lock-head:/packages//version
```

Also define an all-or-none co-change group:

```text
package.json
package-lock.json
```

Because every PR is required to change `package.json`, this makes the lockfile version update mandatory in the same transaction and prevents silent metadata drift.

## 6. Repo-guard self-protection in the consumer

The consumer workflow must pin exactly:

```text
netkeep80/repo-guard@e5b9063c9d1c9e05404ec32b78ca005c278839ce
```

Define `.github/workflows/repo-guard.yml` as a named YAML HEAD document and use only generic `scalar_equals_literal` relations for these facts:

```text
/jobs/policy-check/steps/1/uses = netkeep80/repo-guard@e5b9063c9d1c9e05404ec32b78ca005c278839ce
/jobs/policy-check/steps/1/with/mode = check-pr
/jobs/policy-check/steps/1/with/enforcement = blocking
/permissions/contents = read
/permissions/issues = read
/permissions/pull-requests = read
```

If the exact action step index changes during implementation, first inspect the resulting YAML document and use the real stable pointer; do not weaken the invariant to text matching.

No workflow-specific repo-guard runtime kind, plugin or callback is allowed.

## 7. RED -> GREEN external proof

The proof runs on one real PR against `main`.

### RED state

First commit the final repo-guard candidate pin and stricter proposed policy while leaving both package versions at `0.5.0`.

Expected repo-guard result:

```text
FAIL document-relation:<version-monotonic-id>
HEAD 0.5.0 is not strictly greater than BASE 0.5.0
```

Acceptance of RED requires recording:

- exact BASE SHA;
- exact RED HEAD SHA;
- exact repo-guard candidate SHA;
- workflow run ID;
- failing relation diagnostic;
- independent ordinary CI state so unrelated project failures are not mistaken for the repo-guard falsifier.

### GREEN state

On the same PR update:

```text
package.json      0.5.0 -> 0.5.1
package-lock.json 0.5.0 -> 0.5.1
```

The final exact head must prove:

- semver relation passes;
- package/lock equality passes;
- repo-guard workflow self-relations pass;
- ordinary CI passes;
- browser acceptance passes;
- no MTS semantic or accepted dependency lock changed.

Only this GREEN head may be merged.

## 8. CI/CD compression

### 8.1 Current observed baseline

Reference main run:

```text
CI run = 32727669037
main = 8181a444ca96159b18b50f8ec93d1d323d3acdf9
wall clock ~2 minutes
unit tests = 158 pass, ~0.5 s test execution
browser = 22 pass + 20 skipped, ~1.3 min test execution
```

Current core job performs materialization through both npm lifecycle hooks:

```text
npm run check -> precheck -> deps:prepare
npm test      -> pretest  -> deps:prepare
```

The second materialization mostly detects the already-prepared state but is still redundant orchestration. A separate `mts-core-consumer` job starts another runner and materializes core independently.

The browser job also performs its own required dependency preparation. This is acceptable because it is an independent runner with a separate acceptance role.

### 8.2 Target core flow

Change package scripts so CI can call checks without implicit repeated preparation. Preserve convenient developer-facing commands if useful, but CI must have a single explicit preparation boundary.

Target core job:

```text
checkout
setup node
npm ci
npm run deps:prepare                  # exactly once in this job
npm run check:<prepared>              # syntax/static checks only
npm run test:<prepared>               # unit tests only
node scripts/verify-mts-core-consumer.mjs
npm run site:build
```

Exact script names may be compacted during planning, but their ownership must remain unambiguous: preparation is separate from checks that consume prepared artifacts.

The existing exact @mts/core consumer assertion remains a named, fail-closed step. It may move into the core job; its semantic coverage must not be deleted.

### 8.3 Job topology

Target PR CI jobs:

```text
core
browser-acceptance
```

The historical third `mts-core-consumer` runner is removed only after its check exists in `core` as a separately named step.

This reduces runner startup and repeated materialization while retaining independent browser evidence.

### 8.4 Concurrency

Add workflow-level PR concurrency:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

The intent is to stop obsolete runs when a new commit is pushed to the same PR.

Pages already has its own deployment concurrency and remains separately reproducible.

### 8.5 Browser parallelism

Change Playwright from:

```text
fullyParallel = false
workers = 1
```

to:

```text
fullyParallel = false
workers = 2
```

This allows separate spec files to execute concurrently without allowing test cases inside one file to become fully parallel.

If the first measured run fails because browser specs share hidden mutable state, that is a concurrency falsifier. Restore `workers = 1` rather than weaken assertions or introduce sleeps solely to improve the metric.

### 8.6 Explicit non-optimizations

Do not introduce in this slice:

- custom CI containers;
- reusable workflow hierarchy;
- cross-job generated dependency artifacts;
- speculative npm/Playwright caches beyond existing runner behavior;
- browser-test deletion or skipping for speed;
- coupling Pages deployment to a PR-generated site artifact.

These are only reconsidered if post-change measurement shows the remaining cost justifies new complexity.

## 9. Measurement model

Record a before/after table in issue #121 and upstream repo-guard #381.

At minimum compare:

| Measure | Before | After |
| --- | --- | --- |
| repo-guard exact SHA | old pin | final candidate |
| version monotonicity | not enforced | enforced |
| unchanged version PR | not structurally prevented by current policy | rejected by relation |
| package/lock version equality | not governed by repo-guard | governed |
| workflow action/config invariants | not represented in current consumer policy | generic relations |
| consumer-specific repo-guard core code | 0 | 0 |
| PR CI runner jobs | 3 | target 2 |
| repeated dependency preparation in core runner | 2 lifecycle invocations | 1 explicit invocation |
| browser workers | 1 | target 2 if green |
| browser test wall-clock | baseline from exact run | measured exact final head |
| CI wall-clock | baseline from exact run | measured exact final head |
| stale PR run cancellation | absent | enabled |
| Pages displayed version | v0.5.0 | v0.5.1 after deploy |

The comparison must distinguish architecture wins from raw speed. A faster CI alone is not evidence for repo-guard; a rejected no-bump PR and workflow/version relations are direct repo-guard evidence.

## 10. Scope and boundaries

Expected implementation files:

```text
repo-policy.json
.github/workflows/repo-guard.yml
.github/workflows/ci.yml
package.json
package-lock.json
playwright.config.mjs
docs/superpowers/specs/2026-09-11-repo-guard-version-ci-design.md
```

An implementation plan document may also be added under `docs/superpowers/plans/` after this design is accepted.

Must not change merely for this work:

```text
contracts/**
src/** parser/deserializer/semantic behavior
examples/** semantic corpus
@mts/core accepted lock
@mts/visual accepted lock
```

`src/app.js` and `scripts/build-static-site.mjs` already implement the correct version flow and should remain unchanged unless a RED test proves the documented flow is false.

## 11. Governance transaction

Issue #121 is the external authorization authority for governance-path changes:

```repo-guard-grant
authorized_governance_paths:
  - repo-policy.json
  - .github/workflows/repo-guard.yml
allow_policy_relaxation: []
allow_atomic_governance_cutover: true
```

The implementation PR ChangeIntent must include every actual changed path and must not claim broader semantic work.

The policy transition is stricter: it adds relations and version requirements. No compatibility shim is allowed.

## 12. Merge and release behavior

Merge only when all of these are true on one stable exact head:

```text
repo-guard blocking check = GREEN
core CI = GREEN
browser acceptance = GREEN
draft = false
mergeable = true
base is current main / behind_by = 0
no unexpected files in diff
```

Use `expected_head_sha` for merge.

After merge, require evidence on the exact new main:

```text
post-merge CI GREEN
Pages workflow GREEN
published Pages package.json.version = 0.5.1
published UI visibly derives v0.5.1 from package.json
```

Then record the external consumer proof and before/after metrics in `netkeep80/repo-guard#381`.

## 13. Success criteria

The slice is complete only when:

1. a real no-version-bump PR state has failed specifically because of the new generic semver relation;
2. the same PR reaches GREEN with `0.5.1` in package and lock metadata;
3. every subsequent normal PR is structurally required to raise semver;
4. the published site continues to use `package.json` as its only version authority;
5. repo-guard protects its own consumer workflow facts without project-specific runtime logic;
6. CI coverage is retained and orchestration is measurably compressed or, where a proposed optimization is falsified, the safe result is documented;
7. no MTS/parser/visual semantic change is mixed into the transaction;
8. exact merge and post-merge evidence is recorded upstream.
