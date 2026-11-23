# 01: Test seams and injectable orchestration

**What to build:** Export the pipeline orchestrator as a function that receives its collectors, enricher, publisher, state store and clock by injection, and let source adapters receive an injected fetch. Behavior is unchanged, but the whole pipeline and both adapters can be exercised offline.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] The orchestrator is callable with fake dependencies and returns the same decisions as the real run
- [x] Source adapters accept a fetch implementation and are tested against recorded payloads
- [x] Orchestrator tests cover publish versus hold, window computation, buffer roll-forward, publish failure buffering and partial collection failure
- [x] `npm test` passes with no network, model or Notion access

## Comments

Implemented on `ticket/01-test-seams`.

- `src/pipeline.ts` exports `runPipeline(deps, options)` — the injection seam for collect, enrich, publish, state store, clock, config, sources and env. `src/cli.ts` is now a thin wrapper that wires the real dependencies and renders the dry run.
- `src/collector/github.ts` and `src/collector/website.ts` take an optional `FetchLike` (default global `fetch`); `FetchLike` lives in `src/types.ts`.
- `src/state/store.ts` was imported by `src/cli.ts` but missing from the tree, so `typecheck` failed before this ticket. It was authored here (load/save/savePending/reset) and covered by `tests/state.test.ts`.
- Tests: `tests/pipeline.test.ts` (orchestrator), `tests/collector.test.ts` (adapters), `tests/state.test.ts` (store). 35 tests, no network access.
- Behavior kept identical, including two existing quirks now pinned by tests: a first run with no prior digest always publishes (bootstrap counts as due), and a partial collection failure only exits non-zero on the publish path.

