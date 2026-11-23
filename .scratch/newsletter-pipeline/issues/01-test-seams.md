# 01: Test seams and injectable orchestration

**What to build:** Export the pipeline orchestrator as a function that receives its collectors, enricher, publisher, state store and clock by injection, and let source adapters receive an injected fetch. Behavior is unchanged, but the whole pipeline and both adapters can be exercised offline.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The orchestrator is callable with fake dependencies and returns the same decisions as the real run
- [ ] Source adapters accept a fetch implementation and are tested against recorded payloads
- [ ] Orchestrator tests cover publish versus hold, window computation, buffer roll-forward, publish failure buffering and partial collection failure
- [ ] `npm test` passes with no network, model or Notion access
