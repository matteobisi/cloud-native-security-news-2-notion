# Cloud-Native Security Newsletter

A local pipeline that turns new releases and announcements from a curated set of cloud-native security sources into a periodic Notion digest.

## Language

**Digest**:
One published newsletter issue — the unit of output published to Notion for a given period.
_Avoid_: Newsletter issue, report, edition

**Source**:
A single entry in `config/sources/*.yaml` that the pipeline watches for new content.
_Avoid_: Feed, target, endpoint

**Category**:
A named grouping of sources (e.g. `cloud-native-k8s`, `security-tools`), declared in one source file.
_Avoid_: Topic, section

**Priority**:
A source's importance tier — CRITICAL, HIGH, or MEDIUM — declared per file as a default and optionally overridden per Source, used to decide what is worth including.
_Avoid_: Severity, rank

**Source type**:
The adapter that reads a Source's endpoint — `github_release`, `rss`, `json_feed`, or `website`.
_Avoid_: Kind, format, feed type

**Enabled source**:
A Source whose category and entry are both enabled; only enabled Sources are collected.
_Avoid_: Active source, live source

**Dormant**:
A category or Source marked `enabled: false`; retained for reference but never collected, and not validated beyond YAML parsing.
_Avoid_: Disabled, inactive

**Item**:
A single new piece of content discovered at a source, such as one release or one announcement.
_Avoid_: Entry, article, post, story

**Collector**:
The deterministic part of the pipeline that fetches sources and normalizes them into items.
_Avoid_: Scraper, fetcher

**Enrichment**:
The model-driven step that judges, ranks, and writes prose about collected items.
_Avoid_: Summarizer, AI step

**Qualifying item**:
An item from a CRITICAL or HIGH source that carries a security signal and therefore counts toward publishing a digest.
_Avoid_: Relevant item, important item

**Digest window**:
The period a digest covers — from the last published digest, capped so a long gap cannot produce an unbounded issue.
_Avoid_: Lookback, date range
