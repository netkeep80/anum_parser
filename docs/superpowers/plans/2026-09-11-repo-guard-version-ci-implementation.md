# Repo-guard Version Governance and CI Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `anum_parser` a real repo-guard C3.10 external consumer where every PR must advance semver, Pages publishes that same version, workflow invariants are self-protected, and CI is measurably compressed without reducing coverage.

**Architecture:** Use only final generic `document_relations` plus existing co-change governance. `package.json` remains the single version authority; `package-lock.json` must match it. CI keeps two independent validation roles (`core`, `browser-acceptance`) but removes duplicate preparation and adds stale-run cancellation. The proof is one real PR against `main` with an intentional no-bump RED followed by a `0.5.1` GREEN.

**Tech Stack:** GitHub Actions, repo-guard v3 candidate `e5b9063c9d1c9e05404ec32b78ca005c278839ce`, Node.js 24, npm, Playwright 1.62.1, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-11-repo-guard-version-ci-design.md`

## Global Constraints

- GitHub is the source of truth; re-read exact live state before every write, PR transition and merge.
- Implementation issue: `#121`.
- Opening accepted main: `8181a444ca96159b18b50f8ec93d1d323d3acdf9`.
- Repo-guard candidate: `e5b9063c9d1c9e05404ec32b78ca005c278839ce`.
- No MTS semantic, parser/deserializer, visual semantic, `@mts/core` lock or `@mts/visual` lock changes.
- `package.json` is the only application-version authority.
- No new repo-guard primitive or consumer-specific validator.
- Do not weaken/remove browser acceptance for speed.
- Merge only exact stable GREEN head with `expected_head_sha`.

---

### Task 1: Open the real proof PR with final governance policy and intentional version RED

**Files:**
- Modify: `repo-policy.json`
- Modify: `.github/workflows/repo-guard.yml`
- Existing design docs remain in the branch.

**Interfaces:**
- Consumes: issue #121 GovernanceGrant and final repo-guard document relation surface.
- Produces: a real PR against `main` whose proposed policy is final except for the intentionally unchanged application version.

- [ ] **Step 1: Re-read live authority**

Fetch exact `main`, issue #121, current `repo-policy.json`, `.github/workflows/repo-guard.yml`, and open PRs. Abort/rebase the proof branch if `main` moved unexpectedly.

Expected opening main:

```text
8181a444ca96159b18b50f8ec93d1d323d3acdf9
```

- [ ] **Step 2: Extend `repo-policy.json` with named documents**

Keep all existing policy fields and add a `document_relations` section with these documents:

```json
{
  "base-package": {
    "path": "package.json",
    "format": "json",
    "snapshot": "base"
  },
  "head-package": {
    "path": "package.json",
    "format": "json",
    "snapshot": "head"
  },
  "head-package-lock": {
    "path": "package-lock.json",
    "format": "json",
    "snapshot": "head"
  },
  "repo-guard-workflow": {
    "path": ".github/workflows/repo-guard.yml",
    "format": "yaml",
    "snapshot": "head"
  }
}
```

- [ ] **Step 3: Add the version transition and coherence relations**

Add:

```json
{
  "id": "application-version-monotonic",
  "kind": "scalar_strictly_greater",
  "comparator": "semver",
  "left": {
    "document": "head-package",
    "pointer": "/version",
    "type": "string"
  },
  "right": {
    "document": "base-package",
    "pointer": "/version",
    "type": "string"
  }
}
```

and:

```json
{
  "id": "package-lock-version-matches",
  "kind": "scalar_equal",
  "left": {
    "document": "head-package",
    "pointer": "/version",
    "type": "string"
  },
  "right": {
    "document": "head-package-lock",
    "pointer": "/packages//version",
    "type": "string"
  }
}
```

- [ ] **Step 4: Add workflow self-protection relations**

Add six `scalar_equals_literal` rules against `repo-guard-workflow`:

```json
{
  "id": "repo-guard-workflow-action-pin",
  "kind": "scalar_equals_literal",
  "source": {
    "document": "repo-guard-workflow",
    "pointer": "/jobs/policy-check/steps/1/uses",
    "type": "string"
  },
  "value": "netkeep80/repo-guard@e5b9063c9d1c9e05404ec32b78ca005c278839ce"
}
```

```json
{
  "id": "repo-guard-workflow-mode",
  "kind": "scalar_equals_literal",
  "source": {
    "document": "repo-guard-workflow",
    "pointer": "/jobs/policy-check/steps/1/with/mode",
    "type": "string"
  },
  "value": "check-pr"
}
```

```json
{
  "id": "repo-guard-workflow-enforcement",
  "kind": "scalar_equals_literal",
  "source": {
    "document": "repo-guard-workflow",
    "pointer": "/jobs/policy-check/steps/1/with/enforcement",
    "type": "string"
  },
  "value": "blocking"
}
```

```json
{
  "id": "repo-guard-workflow-permission-contents",
  "kind": "scalar_equals_literal",
  "source": {
    "document": "repo-guard-workflow",
    "pointer": "/permissions/contents",
    "type": "string"
  },
  "value": "read"
}
```

```json
{
  "id": "repo-guard-workflow-permission-issues",
  "kind": "scalar_equals_literal",
  "source": {
    "document": "repo-guard-workflow",
    "pointer": "/permissions/issues",
    "type": "string"
  },
  "value": "read"
}
```

```json
{
  "id": "repo-guard-workflow-permission-pull-requests",
  "kind": "scalar_equals_literal",
  "source": {
    "document": "repo-guard-workflow",
    "pointer": "/permissions/pull-requests",
    "type": "string"
  },
  "value": "read"
}
```

Before committing, verify that the repo-guard action remains step index `1`; if not, use the actual stable YAML pointer rather than weakening the check.

- [ ] **Step 5: Add package metadata co-change**

Add an all-or-none co-change group:

```json
{
  "id": "application-version-metadata",
  "members": [
    "package.json",
    "package-lock.json"
  ]
}
```

- [ ] **Step 6: Repin the consumer workflow only**

Change:

```yaml
uses: netkeep80/repo-guard@03e24a781f024ab1c91e79678737fe4ded743d48
```

to:

```yaml
uses: netkeep80/repo-guard@e5b9063c9d1c9e05404ec32b78ca005c278839ce
```

Do not change mode, enforcement, permissions, checkout behavior or trigger semantics in this RED commit.

- [ ] **Step 7: Keep `package.json` and `package-lock.json` at `0.5.0`**

This is the intentional falsifier. Do not touch the application version yet.

- [ ] **Step 8: Commit the RED governance state**

Commit message:

```text
test(governance): require version advance with repo-guard v3
```

- [ ] **Step 9: Open a non-draft PR against `main`**

PR body ChangeIntent:

```repo-guard-yaml
change_type: governance
scope:
  - repo-policy.json
  - .github/workflows/repo-guard.yml
  - .github/workflows/ci.yml
  - package.json
  - package-lock.json
  - playwright.config.mjs
  - docs/superpowers/specs/2026-09-11-repo-guard-version-ci-design.md
  - docs/superpowers/plans/2026-09-11-repo-guard-version-ci-implementation.md
budgets:
  max_new_docs: 2
  max_new_files: 2
  max_net_added_lines: 900
anchors:
  affects: []
  implements: []
  verifies: []
must_touch:
  - repo-policy.json
  - .github/workflows/repo-guard.yml
  - package.json
  - package-lock.json
must_not_touch:
  - contracts/**
  - src/**
  - examples/**
expected_effects:
  - every PR must advance application semver relative to BASE
  - package and package-lock application versions remain equal
  - repo-guard workflow invariants are protected by generic document relations
  - CI orchestration is compressed without reducing validation coverage
  - Pages publishes the same package.json version
```

Link/fix issue #121.

- [ ] **Step 10: Capture the expected RED**

Wait for the exact PR-head repo-guard run and require failure specifically on:

```text
document-relation:application-version-monotonic
```

Expected operands:

```text
BASE = 0.5.0
HEAD = 0.5.0
relation = strictly greater semver
```

Record run ID, exact head and diagnostic in issue #121 before moving to GREEN.

---

### Task 2: Convert the same PR to GREEN with canonical `0.5.1`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: RED proof from Task 1.
- Produces: a valid BASE `0.5.0` -> HEAD `0.5.1` transition with coherent package metadata.

- [ ] **Step 1: Re-read PR exact head and `main`**

Confirm the RED head is still the PR head and `main` has not moved.

- [ ] **Step 2: Update `package.json`**

Change exactly:

```json
"version": "0.5.0"
```

to:

```json
"version": "0.5.1"
```

- [ ] **Step 3: Update `package-lock.json` root metadata**

Change both top-level and root package versions from `0.5.0` to `0.5.1`:

```json
"version": "0.5.1"
```

and:

```json
"packages": {
  "": {
    "name": "anum-parser-lab",
    "version": "0.5.1"
  }
}
```

Do not change dependency versions.

- [ ] **Step 4: Commit the version GREEN**

Commit message:

```text
chore: advance anum_parser to 0.5.1
```

- [ ] **Step 5: Verify repo-guard turns GREEN**

Require all new document relations to pass, especially:

```text
application-version-monotonic
package-lock-version-matches
repo-guard-workflow-action-pin
repo-guard-workflow-mode
repo-guard-workflow-enforcement
repo-guard-workflow-permission-contents
repo-guard-workflow-permission-issues
repo-guard-workflow-permission-pull-requests
```

If any workflow pointer is wrong, fix the pointer in policy; do not replace the relation with text matching.

---

### Task 3: Remove repeated preparation from core CI without changing coverage

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: existing materializers and tests.
- Produces: one prepared core workspace reused by syntax checks, unit tests, MTS consumer verification and site build.

- [ ] **Step 1: Add prepared-only npm scripts**

Refactor scripts so preparation and validation can be invoked independently. Keep existing developer-friendly `check` and `test` semantics if desired, but add explicit prepared-only scripts:

```json
"check:prepared": "node --check src/model.js && node --check src/formats.js && node --check src/carrier.js && node --check src/deserializers.js && node --check src/serializers.js && node --check src/visual-model.js && node --check src/cytoscape-adapter.js && node --check src/visualizer.js && node --check src/mts-visual-adapter.js && node --check src/app.js && node --check scripts/materialize-mts-visual.mjs && node --check scripts/materialize-three.mjs && node --check scripts/build-static-site.mjs && node --check scripts/serve-static.mjs && node --check playwright.config.mjs && node --check tests/browser/3d-acceptance.spec.mjs",
"test:prepared": "node --test tests/*.test.mjs"
```

Then define the public commands through those prepared-only commands:

```json
"check": "npm run deps:prepare && npm run check:prepared",
"test": "npm run deps:prepare && npm run test:prepared"
```

Remove `precheck` and `pretest` hooks so lifecycle magic no longer triggers a second preparation when CI deliberately controls the boundary.

- [ ] **Step 2: Collapse `test` + `mts-core-consumer` into one core job**

Replace the current `test` job with a named `core` job that runs:

```yaml
- run: npm ci
- name: Prepare exact runtime and browser dependencies
  run: npm run deps:prepare
- name: Syntax checks
  run: npm run check:prepared
- name: Unit tests
  run: npm run test:prepared
- name: Verify accepted @mts/core consumer lock
  run: node scripts/verify-mts-core-consumer.mjs
- name: Reproducible site build
  run: npm run site:build
```

Delete the separate `mts-core-consumer` job only after the named verification step is present in `core`.

- [ ] **Step 3: Add CI concurrency**

At workflow level add:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

Keep both `pull_request` and `push: main` triggers.

- [ ] **Step 4: Commit CI core compression**

Commit message:

```text
ci: reuse one prepared core workspace
```

- [ ] **Step 5: Verify exact-head CI**

Require `core` to pass all 158 unit tests plus the exact @mts/core consumer check and site build.

---

### Task 4: Falsify and, if valid, accept two-worker browser execution

**Files:**
- Modify: `playwright.config.mjs`

**Interfaces:**
- Consumes: existing browser suite and independent browser job.
- Produces: either a proven faster two-worker configuration or documented evidence that serial execution is required.

- [ ] **Step 1: Change only the worker count**

Change:

```js
workers: 1,
```

to:

```js
workers: 2,
```

Keep:

```js
fullyParallel: false,
retries: 0,
```

- [ ] **Step 2: Commit the browser concurrency probe**

Commit message:

```text
ci: run browser specs with two workers
```

- [ ] **Step 3: Evaluate the exact workflow result**

Success criterion:

```text
22 passed
20 skipped
0 failed
```

and browser wall-clock is recorded.

- [ ] **Step 4: If concurrency fails, revert only `workers` to 1**

Do not add sleeps, retries or weaker assertions merely to make two workers pass.

Record the failure as a useful CI-concurrency falsifier in issue #121.

---

### Task 5: Final exact-head verification and architecture/benefit measurement

**Files:**
- No new production files expected.
- Update issue #121 evidence only.

**Interfaces:**
- Consumes: final PR head.
- Produces: accepted external proof metrics and merge-ready evidence.

- [ ] **Step 1: Inspect final PR diff**

Expected files are limited to:

```text
repo-policy.json
.github/workflows/repo-guard.yml
.github/workflows/ci.yml
package.json
package-lock.json
playwright.config.mjs
docs/superpowers/specs/2026-09-11-repo-guard-version-ci-design.md
docs/superpowers/plans/2026-09-11-repo-guard-version-ci-implementation.md
```

No `contracts/**`, `src/**` or `examples/**` changes are allowed.

- [ ] **Step 2: Require all exact-head checks GREEN**

At minimum:

```text
repo-guard blocking check = success
core = success
browser-acceptance = success
```

- [ ] **Step 3: Measure before/after**

Record in issue #121:

```text
before main/run: 8181a444... / CI 32727669037
before jobs: 3
before unit tests: 158 pass
before browser: 22 pass, 20 skipped, ~1.3 min
before workflow version governance: absent
before stale-run cancellation: absent
```

Then record exact final-head run IDs and:

```text
final jobs
core wall-clock
browser wall-clock
whole CI wall-clock
worker count accepted
version relation result
package-lock coherence result
workflow self-protection relation results
```

- [ ] **Step 4: Record direct repo-guard advantages separately from CI speed**

Explicitly state whether the new repo-guard proved each item:

```text
unchanged-version PR rejected = yes/no
version downgrade structurally rejected by same relation = yes by semantics / otherwise evidence
package/lock drift rejected = yes/no
workflow Action SHA drift rejected = yes/no
workflow mode/enforcement/permissions drift rejected = yes/no
consumer-specific repo-guard core code = 0
new validator/rule family = 0
```

- [ ] **Step 5: Re-read `main`, PR metadata and issue #121 immediately before merge**

Require:

```text
base == current main
behind_by == 0
draft == false
mergeable == true
head SHA stable
all required/applicable checks GREEN
```

---

### Task 6: Exact-head merge, post-merge CI/Pages verification and upstream C3.10 evidence

**Files:**
- No further repository content changes expected.

**Interfaces:**
- Consumes: exact accepted PR head.
- Produces: accepted `anum_parser` main, public `v0.5.1`, and second C3.10 external-consumer evidence.

- [ ] **Step 1: Merge with exact expected head**

Use the repository's normal merge method and pass `expected_head_sha` equal to the accepted final PR head.

- [ ] **Step 2: Confirm exact new main**

Fetch `main` and verify it is the merge result containing the accepted PR head.

- [ ] **Step 3: Require post-merge CI GREEN on exact main SHA**

Do not infer success from pre-merge checks.

- [ ] **Step 4: Require Pages deployment GREEN on exact main SHA**

Confirm the Pages workflow run completed successfully.

- [ ] **Step 5: Verify published version authority**

Verify the deployed Pages `package.json` reports:

```json
{"version":"0.5.1"}
```

within its complete package metadata, and verify the public UI displays `v0.5.1`.

- [ ] **Step 6: Close issue #121 only after all post-merge evidence exists**

Post the RED head/run, GREEN head/runs, merge SHA, Pages run and before/after metric table.

- [ ] **Step 7: Update `netkeep80/repo-guard#381`**

Record `anum_parser` as the materially different simple transition consumer and include:

```text
exact consumer BASE
exact RED HEAD/run
exact GREEN HEAD/runs
exact repo-guard candidate SHA
version transition 0.5.0 -> 0.5.1
no new primitive/core logic
workflow self-protection evidence
CI before/after metrics
exact merge SHA
post-merge CI/Pages evidence
```

Do not mark C3.10 release-ready unless all remaining #381 self-host/metrics/release gates are independently satisfied.
