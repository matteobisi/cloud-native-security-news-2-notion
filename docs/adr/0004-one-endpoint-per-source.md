# One endpoint per Source, typed by adapter

Every entry in `config/sources/*.yaml` is exactly one ingestion endpoint read by exactly one adapter, and `type` names that adapter (`github_release`, `rss`, `json_feed`, `website`). We replaced the content-channel vocabulary — `github_repo` and `mailing_list` — because both described intent that no collector implemented: `github_repo` was silently read through the releases endpoint (returning nothing for `kubernetes/enhancements` and `cncf/tag-security`), and `mailing_list` was dropped at load time, including the Kubernetes security-announce channel. Supplementary feeds are now their own Sources rather than fields (`cve_feed`, `changelog`) that nothing consumed, and a Kubernetes CVE feed is read as a generic JSON Feed 1.1 document instead of a bespoke CVE adapter.

## Considered Options

- **Keep `type` as a content kind** (`release`, `advisory`, `announcement`) and add a separate adapter field. Rejected: two fields for one concept, and the kind is only useful once something consumes it.
- **Bespoke `cve_feed` type.** Rejected: the Kubernetes feed already conforms to JSON Feed 1.1, so a generic `json_feed` adapter costs less and covers future feeds.
- **Rescue the mailing list via a Google Groups atom feed.** Rejected: Google Groups no longer serves one (404), so the channel had to be re-sourced anyway.
- **Attach multiple endpoints to one Source** (`changelog`, `cve_feed`). Rejected: an entry with several URLs has no single identity for state, dedupe, or per-source limits.

## Consequences

- `mailing_list` and `github_repo` disappear from the registry; the two dead sources are removed and the security-announce channel is replaced by the Kubernetes CVE feed.
- An upstream project with two distinct feeds becomes two Sources; the one-endpoint rule is enforced at load time, so duplicate endpoints fail the run instead of wasting quota.
- Adapters stay independent and fixture-testable, preserving ADR-0001's deterministic-collection boundary.
