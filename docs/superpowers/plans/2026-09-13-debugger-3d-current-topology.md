# Debugger 3D Current Topology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 3D debugger physical/rendered topology equal the current debugger step instead of the final Aset hidden by presentation visibility.

**Architecture:** `anum_parser` keeps the full projected `VisualLinkNetwork` for 2D/blueprint consumers, but owns a separate current-step 3D network derived strictly from `debugState.visibleLinkIds`. While 3D is mounted, step changes use the accepted `@mts/visual/three` whole-network transition boundary; while it is unmounted, the retained live controller uses the accepted root transition boundary. Parser-specific current/produced/reused/selected roles remain presentation-only.

**Tech Stack:** JavaScript ES modules, Node 24 test runner, exact-pinned `@mts/visual@0.3.0`, Three.js 0.185.1, Playwright 1.62.1, GitHub Actions + blocking repo-guard.

**Spec:** GitHub issue #124.

## Global Constraints

- Upstream authority is exactly `netkeep80/mts_visual@4b7c8e97fab8d84a31783a4d8e422dcb12a4e795`.
- Upstream package is exactly `@mts/visual@0.3.0`.
- Upstream `package.json` blob is exactly `30647a915e8d2e5df8fa896b18596593468af5d4`.
- Upstream `package-lock.json` blob is exactly `a2ad851dbf618d62196227a448221da0e8c53077`.
- `contracts/mts-core-consumer-lock.json` blob `3aa9f238da179f0989f3a9444ac24d9a1d678b17` must remain unchanged.
- Do not change parser/deserializer semantics, repo policy, workflows, or 2D/blueprint implementation.
- `scripts/materialize-mts-visual.mjs` remains unchanged unless an exact-lock verification failure proves otherwise; it is already lock-driven.
- No deep import from `mts_visual/src/**` and no local duplicate topology-transition/physics solver.
- Application version advances from live `0.5.1` to `0.5.2` under current version-governance, unless `main` moves before the write.
- Every production behavior change follows RED -> GREEN.

## Execution status — 2026-09-13

Implementation through the Task 5 behavior is complete in PR #125. The clean browser RED was recorded on `f27f6742c4aecf8ab14e519a02adfec66e0f2c19`: after `debugFirst`, the old wiring still reported `nodeCount = 11`, equal to the final topology. Production head `7aaddb6aa5ddd282426b8c049c0d2528eaf7c022` then passed CI #242 completely: Core validation GREEN, exact semantic-core lock verification GREEN, reproducible site GREEN, and full Chromium browser acceptance GREEN. Exact diff audit showed only the eight declared paths, with `behind_by=0` and `mergeable=true`. PR #125 is Ready. This documentation-only synchronize commit exists because the blocking repo-guard workflow listens to `opened` and `synchronize`, not `ready_for_review`; it therefore triggers the required blocking gate without altering production behavior.

---

### Task 1: RED proof for parser-owned current-step projection

**Files:**
- Modify: `tests/mts-visual-consumer.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: existing `projectAsetToVisualLinkNetwork(aset)`.
- Produces test contract for: `projectDebugStepVisualLinkNetwork(aset, debugState = null)`.

- [ ] **Step 1: Advance application version metadata only**

Set `package.json.version`, `package-lock.json.version`, and `package-lock.json.packages[""].version` from `0.5.1` to `0.5.2`. Do not change any dependency entry or integrity value.

- [ ] **Step 2: Write failing adapter tests**

Import `projectDebugStepVisualLinkNetwork` from `src/mts-visual-adapter.js` and add tests equivalent to:

```js
const aset = kernelAset([{ id: "X", start: "L", end: "U" }]);
const base = ["R", "O", "C", "L", "U"];

assert.deepEqual(
  projectDebugStepVisualLinkNetwork(aset, { visibleLinkIds: base }).links.map(({ key }) => key),
  ["C", "L", "O", "R", "U"],
);
assert.equal(
  projectDebugStepVisualLinkNetwork(aset, { visibleLinkIds: [...base, "X"] }).links.some(({ key }) => key === "X"),
  true,
);
assert.equal(
  projectDebugStepVisualLinkNetwork(aset, { visibleLinkIds: base }).links.some(({ key }) => key === "X"),
  false,
);
assert.throws(
  () => projectDebugStepVisualLinkNetwork(aset, { visibleLinkIds: ["R", "X"] }),
  /not reference-closed.*X.*L|not reference-closed.*X.*U/,
);
assert.deepEqual(
  topology(projectDebugStepVisualLinkNetwork(aset, null)),
  topology(projectAsetToVisualLinkNetwork(aset)),
);
```

Also assert that an unknown `visibleLinkIds` key is rejected explicitly instead of ignored.

- [ ] **Step 3: Open a Draft PR and run CI to verify RED**

Expected failure: the test module cannot import `projectDebugStepVisualLinkNetwork` because the production adapter does not export it yet. The version-governance relation must already be satisfied so the RED cause is the missing behavior, not ceremony.

### Task 2: GREEN current-step projection

**Files:**
- Modify: `src/mts-visual-adapter.js`
- Test: `tests/mts-visual-consumer.test.mjs`

**Interfaces:**
- Consumes: `projectAsetToVisualLinkNetwork(aset)` and `normalizeVisualLinkNetwork(network)`.
- Produces:

```js
projectDebugStepVisualLinkNetwork(aset, debugState = null) -> VisualLinkNetwork
```

- [ ] **Step 1: Implement only the tested projection contract**

Implementation algorithm:

```text
full = projectAsetToVisualLinkNetwork(aset)
if debugState is null/non-object -> return full
wanted = Set(debugState.visibleLinkIds ?? [])
reject every wanted key not present in full
currentLinks = full.links whose key is in wanted
for each current link:
  require wanted contains startKey
  require wanted contains endKey
normalize and return { links: currentLinks }
```

The thrown closure diagnostic must name the offending link and missing endpoint. Never add an endpoint implicitly.

- [ ] **Step 2: Run the same PR CI to verify GREEN**

Expected: unit/exact-consumer suite passes with the old visual lock because this task uses only already-existing normalization APIs.

### Task 3: RED -> GREEN exact visual repin

**Files:**
- Modify: `tests/mts-visual-consumer.test.mjs`
- Modify: `contracts/mts-visual-consumer-lock.json`
- Must not modify: `contracts/mts-core-consumer-lock.json`
- Must not modify: `scripts/materialize-mts-visual.mjs`

**Interfaces:**
- Root API required from materialized package: `transitionLivePhysics3DNetwork(controller, nextNetwork)`.
- Three API required from materialized package: `transitionVisualThreeLiveNetwork(container, nextNetwork)`.

- [ ] **Step 1: Make exact-consumer expectations RED first**

Change test expectations to:

```text
commit = 4b7c8e97fab8d84a31783a4d8e422dcb12a4e795
version = 0.3.0
manifest blob = 30647a915e8d2e5df8fa896b18596593468af5d4
lockfile blob = a2ad851dbf618d62196227a448221da0e8c53077
```

and assert:

```js
assert.equal(typeof root.transitionLivePhysics3DNetwork, "function");
assert.equal(typeof three.transitionVisualThreeLiveNetwork, "function");
```

Run CI and require failure because the consumer lock still materializes `0.2.0`.

- [ ] **Step 2: Repin only the visual consumer lock**

Update `contracts/mts-visual-consumer-lock.json` to the exact accepted identities above. Keep `three = 0.185.1` and all authority booleans unchanged.

- [ ] **Step 3: Verify exact-consumer GREEN and core-lock immutability**

Run CI. Confirm the generated provenance matches the new exact visual pin and the semantic core lock remains blob `3aa9f238da179f0989f3a9444ac24d9a1d678b17`.

### Task 4: Browser RED for real debugger topology evolution

**Files:**
- Modify: `tests/browser/3d-acceptance.spec.mjs`

**Interfaces:**
- Consumes: existing sample `q-10` (`#sample` index `12`), debugger controls, and public `getVisualThreeRendererSnapshot`.
- Produces browser contract for current-step topology transitions.

- [ ] **Step 1: Replace the old constant-topology assertion**

Rewrite `debugger updates generic shared presentation without destroying renderer` so it proves on one mounted renderer:

```text
last step count = final/current last-step topology
First -> nodeCount is smaller than final count
canvas count remains exactly 1
advance with Next until a step adds one or more links -> nodeCount increases
Prev from that step -> nodeCount decreases again
arcCount always equals current nodeCount * 2 for this fixture
```

Pause physics before count/camera/fullscreen assertions. Zoom the camera before transition and require the camera position to remain unchanged across the topology-only step. Force the existing CSS fullscreen fallback before a step and require it to stay active after the step.

- [ ] **Step 2: Add a dynamics assertion**

At a step immediately before a topology addition:

```text
physics paused
-> Next adds topology
-> capture canvas and topology count
-> unpause
-> canvas later changes
-> topology count remains unchanged
```

This proves the newly current topology wakes/resumes shared mechanics without using screenshot comparison as the topology proof.

- [ ] **Step 3: Run Playwright and verify RED**

Expected failure on current production wiring: `debugFirst` keeps `nodeCount`/`arcCount` at the final-network values because only presentation visibility changes.

### Task 5: GREEN 3D current-network lifecycle

**Files:**
- Modify: `src/app.js`
- Test: `tests/browser/3d-acceptance.spec.mjs`

**Interfaces:**
- Consumes:

```js
projectDebugStepVisualLinkNetwork(aset, debugState)
transitionLivePhysics3DNetwork(controller, nextNetwork)
transitionVisualThreeLiveNetwork(container, nextNetwork)
```

- Produces state separation:

```text
state.visualNetwork       = full/final projection for 2D/blueprint
state.visual3dNetwork     = current debugger-step physical topology
state.visualLiveController = live physics for visual3dNetwork
```

No persistent `visualInitialState` is needed; reset can generate a fresh deterministic seed for `visual3dNetwork`.

- [ ] **Step 1: Separate full and current 3D topology state**

Add `visual3dNetwork: null`, remove ambiguous cached `visualInitialState`, and reset `visual3dNetwork`/controller when a new result is rendered.

- [ ] **Step 2: Create controller directly on the current debugger step**

`ensureShared3dController()` must compute `projectDebugStepVisualLinkNetwork(state.result.aset, currentDebugState())` before creating initial physics. Imported Asets with no trace naturally receive the full network.

- [ ] **Step 3: Synchronize topology on every debugger step change**

Add a helper with this behavior:

```text
nextNetwork = projectDebugStepVisualLinkNetwork(aset, currentDebugState())
if live controller exists and 3D is mounted:
  transitionVisualThreeLiveNetwork(ui.graph, nextNetwork)
else if live controller exists:
  transitionLivePhysics3DNetwork(controller, nextNetwork)
state.visual3dNetwork = nextNetwork
```

Call it after changing `state.debugStep` and before applying the step presentation. Do not call `destroyVisualThreeRenderer` for ordinary step changes.

- [ ] **Step 4: Apply presentation only against current 3D key-space**

Use `state.visual3dNetwork` in `applyShared3dPresentation()`. Keep `selectedLinkId` latent if its link is absent, but remove `data-selected-link` and let `projectParserVisualPresentation` ignore it until that key returns to the current topology.

- [ ] **Step 5: Reset physics only for current 3D topology**

`resetCurrentPhysics()` must create a fresh deterministic initial state from `state.visual3dNetwork`, recreate the controller for that current network, and remount only because the user explicitly requested reset—not because of an ordinary debugger step.

- [ ] **Step 6: Run unit + Playwright GREEN verification**

Require all unit/exact-consumer tests and the full browser suite to pass. Confirm the rewritten debugger test observes decrease/increase/decrease with one canvas and preserved camera/fullscreen state.

### Task 6: Final review, blocking gate, exact-head merge, Pages acceptance

**Files:** No new implementation scope.

- [ ] **Step 1: Audit exact diff**

Expected final changed files:

```text
docs/superpowers/plans/2026-09-13-debugger-3d-current-topology.md
src/app.js
src/mts-visual-adapter.js
contracts/mts-visual-consumer-lock.json
tests/mts-visual-consumer.test.mjs
tests/browser/3d-acceptance.spec.mjs
package.json
package-lock.json
```

No `mts-core` lock, deserializer runtime, materializer script, repo policy, workflow, blueprint renderer, or structural 2D implementation change.

- [ ] **Step 2: Mark PR Ready only after full CI is GREEN**

Require exact stable head, `behind_by=0`, `mergeable=true`, full CI GREEN, then run blocking repo-guard on that same SHA.

- [ ] **Step 3: Merge only with `expected_head_sha`**

After a fresh governance refresh, merge the exact verified head and record the new accepted `main`.

- [ ] **Step 4: Verify Pages on the accepted merge**

Use the existing Pages deployment. Confirm deployed version and manually replay the same debugger 3D scenario: first-step topology smaller than final, a produced step physically adds links, Prev removes them, one renderer remains mounted, and visible physics resumes after unpause.
