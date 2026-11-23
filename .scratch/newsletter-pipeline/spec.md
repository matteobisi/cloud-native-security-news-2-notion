# Spec: Cloud-native security digest pipeline

Status: ready-for-agent
Feature: newsletter-pipeline

## Problem Statement

A cloud-native security practitioner wants to keep up with releases and security announcements across roughly sixty projects, but tracking them means visiting many changelogs, release pages and repositories by hand. The work is repetitive, easy to skip, and produces nothing shareable. They want a small managed pipeline they can run without being a developer: it reads a curated list of sources, decides what is genuinely newsworthy, and publishes a well-formatted security newsletter page to Notion. They want it to run locally, on their own Apple Silicon workstation, using Docker Agent and Docker Model Runner rather than cloud model providers or a bespoke Python application.

## Solution

A local-first digest pipeline with three stages: a deterministic Collector that fetches configured Sources and normalizes new content into Items; an Enrichment stage that screens Items for security signals and asks a local model to judge relevance, assign severity and write short prose; and a Renderer that publishes one Digest as a child page under a configured Notion parent page. The pipeline runs on demand and on an optional schedule, remembers what it has already seen, holds quiet weeks until enough Qualifying items accumulate, and degrades gracefully when a Source or the model is unavailable.

## User Stories

1. As a security practitioner, I want to point the pipeline at a curated YAML list of Sources, so that I can maintain coverage without editing code.
2. As a security practitioner, I want each Source to carry a Category and Priority, so that the newsletter reflects what matters most.
3. As a security practitioner, I want only CRITICAL and HIGH Categories included in the first version, so that the digest stays focused.
4. As a security practitioner, I want GitHub release Sources read through the GitHub API, so that releases are detected reliably and cheaply.
5. As a security practitioner, I want GitHub repository Sources handled the same way as release Sources, so that repository-based projects are covered.
6. As a security practitioner, I want website Sources handled best-effort, so that changelog pages without an API still contribute when they change.
7. As a security practitioner, I want mailing-list Sources deferred, so that the first version avoids fragile scraping.
8. As a security practitioner, I want a Source failure to be logged and skipped, so that one bad feed cannot break the whole digest.
9. As a security practitioner, I want a per-Source cap on Items, so that a chatty project cannot dominate the digest.
10. As a security practitioner, I want Items deduplicated by canonical URL and normalized title, so that reposts and cross-listed projects appear once.
11. As a security practitioner, I want Items ranked by Source Priority, then severity, then recency, so that the most important news leads.
12. As a security practitioner, I want a keyword screen over security signals before the model runs, so that enrichment is fast and auditable.
13. As a security practitioner, I want the local model to confirm relevance and assign a 1–5 severity, so that nuance the keywords miss is caught.
14. As a security practitioner, I want a short summary and a "why it matters" line per Item, so that I can scan without opening every link.
15. As a security practitioner, I want the digest to open with an executive summary and top stories, so that the most important news is visible immediately.
16. As a security practitioner, I want CRITICAL Items surfaced as callouts, so that urgent patches are impossible to miss.
17. As a security practitioner, I want each Item collapsed in a toggle with a bookmark link, so that the page stays readable.
18. As a security practitioner, I want the digest to record the window covered, sources scanned and model used, so that I can trust what I am reading.
19. As a security practitioner, I want a digest only when at least three Qualifying items exist, so that quiet weeks do not produce empty newsletters.
20. As a security practitioner, I want a forced digest every thirty days, so that the archive never goes silent.
21. As a security practitioner, I want the Digest window to start at the last published digest and cap at thirty-five days, so that a long gap does not flood the page.
22. As a security practitioner, I want skipped weeks to roll forward, so that nothing is lost while waiting for enough news.
23. As a security practitioner, I want the first run to bootstrap a short lookback, so that it produces something useful immediately.
24. As a security practitioner, I want to run the pipeline on demand with a single command, so that I do not need to remember Docker incantations.
25. As a security practitioner, I want an optional scheduled run that starts Docker first, so that a daily digest arrives without manual work.
26. As a security practitioner, I want a dry run that prints the digest without touching Notion or state, so that I can preview changes safely.
27. As a security practitioner, I want a reset command that clears local state, so that I can start fresh after changes.
28. As a security practitioner, I want a failed Notion publish buffered locally, so that the digest is retried rather than lost.
29. As a security practitioner, I want a non-zero exit code on partial failure, so that scheduled logs reveal problems.
30. As a security practitioner, I want secrets kept in a gitignored environment file, so that tokens are never committed.
31. As a security practitioner, I want all tunables in one human-editable configuration file, so that thresholds, model and categories can change without code.
32. As a security practitioner, I want the model to run locally through Docker Model Runner, so that advisory text never leaves the workstation.
33. As a security practitioner, I want the pipeline packaged as a Docker service and a Docker Agent configuration, so that runs stay reproducible.
34. As a security practitioner, I want the Notion integration to need only a parent page id and token, so that setup is minimal.
35. As a developer, I want the orchestration logic tested through one high seam with injected dependencies, so that cadence and failure behavior are verified without network access.
36. As a developer, I want Source adapters testable against fixtures, so that parsing and filtering are verified offline.
37. As a developer, I want the block renderer tested as a pure function, so that page structure is verified without Notion.
38. As a developer, I want unit tests for the keyword screen and ranking, so that the deterministic parts stay correct.
39. As a developer, I want a dry-run mode that is safe in tests, so that the pipeline can be exercised end to end.
40. As a developer, I want the domain vocabulary and architecture decisions documented, so that future changes use the same language and respect prior reasoning.

## Implementation Decisions

### Stages and boundaries

- The pipeline has three stages: Collector, Enrichment, Renderer. Collection is deterministic and model-free; the model only judges and writes prose. This is recorded in ADR 0001 and is the defining architectural boundary.
- The orchestrator owns cadence, window computation, buffering, ranking, publishing and state transitions. Stage modules do not know about scheduling.
- The orchestrator must be exported as an injectable function taking collectors, enricher, publisher, state store and clock, so it can be driven in tests. This is the highest seam and the only new orchestration seam.
- Source adapters accept an injected fetch implementation, so they can be exercised against recorded responses.

### Collector

- Sources are loaded from the existing YAML registry. Source identity is Category plus Name. Only Categories listed in the pipeline configuration are in scope.
- `github_release` and `github_repo` share one adapter that reads the repository's releases from the GitHub API, newest first, capped per Source.
- The website adapter fetches the page, extracts a title and text, hashes the text, and emits an Item only when the hash differs from the last seen hash.
- `mailing_list` is excluded at configuration-load time.
- A Source failure produces an error record and does not abort the run.
- Collected Items are merged into a persistent buffer, deduplicated by Item id.

### Enrichment

- A deterministic screen matches configured security signals against title and text, preserving the original signal strings for reporting.
- Only screened candidates are sent to the model, as a JSON array containing id, source, category, priority, title, published date and truncated text.
- The model is asked for a JSON array of id, qualifying, severity (1–5), summary and why-it-matters, and is instructed never to invent facts or links.
- If the model is unreachable or returns unusable output, enrichment falls back to rule-based judgements: qualifying when signals matched, severity derived from Source Priority, summary equal to the title.
- Model endpoint and name are read from configuration, with environment overrides for host and container use.

### Ranking and digest selection

- Items are deduplicated by canonical URL (host plus path, query and fragment removed) and by normalized title.
- Ranking is Source Priority, then severity descending, then published date descending.
- Selection caps the digest at the configured maximum and reports how many qualifying Items were omitted.

### Cadence and window

- A run collects new content, merges it into the buffer, enriches the buffer, and counts Qualifying Items inside the current Digest window.
- A digest is published when the Qualifying count reaches the configured minimum, or when the configured number of days has elapsed since the last published digest, or when no digest exists yet.
- The Digest window starts at the last published digest and is capped at the configured maximum lookback. With no prior digest, the bootstrap lookback applies.
- On a skipped run, buffered Items remain and roll forward. State is still saved.
- After a successful publish, all Qualifying Items inside the window are removed from the buffer and the last-published timestamp is recorded.

### Notion rendering

- One Digest is one child page under the configured parent page, using the Notion REST API and a pinned API version. Notion MCP is not used; this is ADR 0002.
- The page is: a level-1 title heading; a summary callout; a "Top stories" heading with three bullets; one level-2 heading per Category; a red callout for each CRITICAL Item; a toggle per Item containing the summary, the why-it-matters line and a bookmark; an omitted-count line when applicable; a divider; and a footer with window, sources scanned and model.
- Content is created with the first hundred blocks when the page is created, then appended in chunks of one hundred.
- Rate-limit and overload responses are retried with the server-provided delay.
- A failed publish writes the whole digest to a pending area and surfaces a non-zero exit.

### State

- State is a JSON document holding per-Source last-seen identifiers, the Item buffer and the last-published timestamp.
- State is gitignored and can be reset. Dry runs neither persist state nor publish.

### Interfaces and contracts

- The Collector contract is: given in-scope Sources, configuration, state and a clock, return new Items, error messages and the number of Sources scanned, while updating last-seen markers.
- The Enrichment contract is: given Items and configuration, return Enriched Items with qualifying, severity, summary and why-it-matters.
- The Renderer contract is: given a Digest, parent page id and token, return a page id and URL.
- The model client contract is: given model settings and a prompt, return parsed JSON, failing loudly on unusable output.
- The state contract is: load, save, reset, and persist a pending digest.

### Configuration and secrets

- `config/pipeline.yaml` holds Categories, cadence thresholds, item limits, model settings, security signals and paths.
- `config/sources/*.yaml` remains the Source registry format.
- `.env` holds the Notion token, parent page id and optional GitHub token; `.env.example` is committed.

### Packaging and operation

- The pipeline is a single Docker image and Compose service; the Compose file wires a model block so Model Runner is available to the container.
- A thin operator entrypoint exposes run, dry-run, reset, build and schedule.
- The Docker Agent configuration is the primary automated entrypoint and shells into the pipeline; it uses the Docker Model Runner provider.
- The scheduled runner starts Docker Desktop, waits for the daemon, and then invokes the agent.
- Model choice is constrained by the workstation's unified memory; the default is a quantized 12B model, configurable.

## Testing Decisions

- A good test exercises external behavior through a public boundary and asserts observable results. It does not assert private helpers, call order, or internal data structures. Tests must not touch the network, a real model or a real Notion workspace.
- The orchestrator is the primary seam. Tests inject fake collectors, enricher, publisher, state store and clock, and assert: publish versus skip decisions, digest window computation, bootstrap behavior, force-publish after the configured interval, buffer roll-forward, removal of published Items, pending-buffer behavior on publish failure, and non-zero exit on partial collection failure.
- Source adapters are a secondary seam. Tests inject a fake fetch returning recorded payloads and assert: GitHub release mapping and window filtering, repository handling, website hash-change detection, and error propagation for non-OK responses.
- The keyword screen is tested for case-insensitive matching and preservation of original signal strings.
- Ranking and selection are tested for URL and title deduplication, ordering by priority and severity, capping and omitted counts.
- The block renderer is tested as a pure function: title heading and summary callout first, red callouts only for CRITICAL Items, every Item rendered as a toggle with a bookmark child, category grouping preserving order, and footer content.
- Prior art: the existing unit tests for the keyword screen, ranking and block rendering establish the style — plain assertions over public functions, no mocking framework, fixtures kept inline. Orchestrator and adapter tests should follow the same style with simple in-memory fakes.
- A live smoke test remains optional and is never part of the default test run.

## Out of Scope

- Mailing-list Sources and any scraping of Google Groups.
- MEDIUM Priority Categories in the first version.
- Output shapes other than a child page per Digest: no Notion database rows and no single rolling page.
- Hosted Notion MCP and the deprecated local Notion MCP server.
- Cloud model providers, cloud hosting and running the scheduled job off the workstation.
- A graphical interface, web server or button-based trigger.
- Multi-context domain documentation.
- Automatic creation of the Notion parent page or integration setup.
- Translation, non-English summaries and editorial moderation workflows.
- Historical backfill beyond the bootstrap lookback.

## Further Notes

- Docker Model Runner is only available while Docker Desktop is running, so schedules silently miss runs when the machine is asleep or Docker is stopped. The scheduled runner mitigates this by starting Docker and waiting; the cadence window compensates for gaps.
- If the configured model has not been pulled, enrichment falls back to rules and the digest is still produced, but summaries will be terse. Operators should pull the model during setup.
- The Notion integration must be granted access to the parent page and must hold insert-content permission, otherwise publishing fails.
- The GitHub API is unauthenticated by default and rate-limited; setting a token in the environment raises the limit substantially.
- Domain vocabulary in this spec follows `GLOSSARY.md`; decisions follow ADR 0001 (deterministic collector plus model enrichment), ADR 0002 (Notion REST), and ADR 0003 (local Docker Model Runner).
