# 02: First end-to-end digest from one GitHub source

**What to build:** A user can point the pipeline at the source registry, have one GitHub release Source collected and screened, and see a digest rendered in dry-run or published as a Notion child page. Rules alone judge items at this stage.

**Blocked by:** 01

**Status:** resolved

- [x] The pipeline loads the in-scope Source registry and collects Items from a GitHub release Source
- [x] Security signals screen Items and rule fallback marks qualifying Items
- [x] Ranking selects Items and a minimal digest renders its title, summary and items
- [x] Dry-run prints the digest without touching Notion or state, and a real run creates a child page
