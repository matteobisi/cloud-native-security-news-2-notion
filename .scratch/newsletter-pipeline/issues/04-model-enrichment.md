# 04: Local model enrichment

**What to build:** Screened items are judged by Docker Model Runner, which confirms relevance, assigns a 1–5 severity and writes a summary and why-it-matters line. When the model is unavailable, the digest still publishes using rule-based judgements.

**Blocked by:** 02

**Status:** resolved

- [x] The model client calls the configured Docker Model Runner endpoint and parses a JSON array
- [x] Judgements populate qualifying, severity, summary and why-it-matters
- [x] Malformed or unavailable model output falls back to rule-based judgements without failing the run
- [x] Model host and name respect configuration and environment overrides
