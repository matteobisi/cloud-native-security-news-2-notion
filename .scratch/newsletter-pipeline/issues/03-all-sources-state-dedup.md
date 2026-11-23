# 03: All in-scope sources with state, dedup and caps

**What to build:** Every in-scope Source is collected on each run, repeat content is suppressed across runs, and duplicates within a run are removed. A Source failure is reported without breaking the digest.

**Blocked by:** 02

**Status:** resolved

- [x] GitHub release and repository Sources are collected; website Sources emit an Item only when their text changes
- [x] Per-Source last-seen markers suppress already-collected Items on the next run
- [x] Items are deduplicated by canonical URL then normalized title
- [x] Per-Source and per-digest caps apply, and omitted Items are counted
- [x] A failed Source is logged and the run continues
