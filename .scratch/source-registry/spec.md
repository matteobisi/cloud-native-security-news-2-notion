# Spec: Source registry and collector type coverage

Status: ready-for-agent
Feature: source-registry
Related: `.scratch/source-registry/design.md` (agreed design and per-file inventory), ADR-0004, ADR-0001
Supersedes: the registry sections of `.scratch/newsletter-pipeline/spec.md` (Source types, mailing-list deferral, category enablement)

## Problem Statement

A security practitioner maintaining the digest registry keeps hitting sources that quietly do nothing and entries that mean less than they appear to. Two Sources are read through an endpoint that never returns anything for them; the Kubernetes security-announce mailing list is discarded at load time; two fields in every file (`changelog`, `cve_feed`) are ignored; Priority is inherited from a file, so developer-loop tooling counts as CRITICAL; and several changelog pages are watched by whole-page hashing when they publish proper feeds. Every run also sits close to the anonymous GitHub rate limit. The result is a registry that is longer than it is useful, and a digest whose quality depends on entries nobody can trust.

## Solution

Make the registry describe exactly what the pipeline does. A Source becomes one ingestion endpoint read by one adapter, with a small, honest type vocabulary (`github_release`, `rss`, `json_feed`, `website`); enablement is explicit in each file instead of implied by a list elsewhere; Priority is a file default with a per-source override; and configuration mistakes fail the run instead of being skipped. The dead and feed-less Sources are removed, the changelog pages that support feeds move to RSS, the Kubernetes CVE feed is read as a JSON Feed, and GitHub access is authenticated and conditional so the registry can grow without hitting the anonymous limit.

## User Stories

1. As a security practitioner, I want every Source in the registry to be one endpoint the pipeline actually reads, so that I can trust an entry to produce Items.
2. As a security practitioner, I want a Source whose endpoint cannot produce Items removed, so that the digest is not padded with silent no-ops.
3. As a security practitioner, I want Source type to name the adapter, so that the value predicts how the Source is read rather than how I think about its content.
4. As a security practitioner, I want only the types the pipeline implements to be valid, so that a typo or a misplaced idea fails loudly.
5. As a security practitioner, I want to disable a whole category in its own file, so that dormancy is visible where the content lives.
6. As a security practitioner, I want to park a single Source without deleting it, so that I can retire something temporarily without losing its URL and notes.
7. As a security practitioner, I want dormant content to be skipped entirely, so that stale URLs do not generate noise or validation failures.
8. As a security practitioner, I want a file-level Priority default with a per-source override, so that auxiliary tooling is not treated as critical merely because of its category.
9. As a security practitioner, I want notes to remain operator documentation only, so that stale prose never biases what the model writes.
10. As a security practitioner, I want two enabled Sources to be unable to share an endpoint, so that quota is not spent fetching the same releases twice.
11. As a security practitioner, I want duplicate Source names within a category rejected, so that state keys stay unambiguous.
12. As a security practitioner, I want a unique category per file, so that enablement and grouping are not split across files.
13. As a security practitioner, I want all configuration mistakes reported in one failure, so that I can fix the registry in one pass.
14. As a security practitioner, I want configuration mistakes to be fatal while network failures remain per-Source, so that a typo cannot masquerade as a flaky feed.
15. As a security practitioner, I want an RSS/Atom adapter, so that changelog pages with feeds contribute per-release Items instead of one whole-page Item.
16. As a security practitioner, I want the Jenkins, GitLab CI, and GitHub Actions Sources to use their feeds, so that releases arrive as individual Items.
17. As a security practitioner, I want a Jenkins security-advisories Source, so that CI/CD vulnerabilities lead the digest.
18. As a security practitioner, I want a JSON Feed adapter, so that the Kubernetes official CVE feed is collected from its canonical machine-readable endpoint.
19. As a security practitioner, I want the Kubernetes CVE feed to replace the discarded mailing list, so that cluster CVE announcements are not lost.
20. As a security practitioner, I want feed Items without a parseable date to be skipped, so that repeated runs do not re-emit undated entries.
21. As a security practitioner, I want feed Items identified by their own id, so that buffering and dedupe behave the same as for releases.
22. As a security practitioner, I want draft GitHub releases always ignored, so that unpublished work never appears.
23. As a security practitioner, I want prerelease GitHub releases ignored by default, so that alpha and beta churn does not qualify.
24. As a security practitioner, I want to opt a Source into prereleases, so that a project whose only security cut is a pre-release is still covered.
25. As a security practitioner, I want GitHub access to require a token, so that the registry can be expanded without hitting the anonymous limit.
26. As a security practitioner, I want a clear failure when the token is missing, so that I am not left reading dozens of per-Source errors.
27. As a security practitioner, I want unchanged repositories to cost no quota, so that repeated runs and debugging are cheap.
28. As a security practitioner, I want added Sources for container runtimes, ingress, workload identity, policy, runtime security, and supply chain, so that the digest covers the layers where cloud-native incidents actually happen.
29. As a security practitioner, I want archived projects removed, so that the registry reflects active maintenance.
30. As a security practitioner, I want the coverage bar applied literally — security-relevant change, machine-readable changelog, recent activity, no unusual auth — so that additions are justified rather than accumulated.
31. As a security practitioner, I want known coverage gaps recorded instead of filled with noisy Sources, so that I can see what the digest does not cover.
32. As a security practitioner, I want the glossary to describe the registry model I am editing, so that the vocabulary in the files and the docs matches.
33. As a developer, I want registry parsing and validation testable against fixture directories, so that schema mistakes are caught without network access.
34. As a developer, I want the feed adapters to accept an injected fetch like the existing adapters, so that parsing and filtering are tested against recorded payloads.
35. As a developer, I want a test that loads the repository's real registry, so that a bad YAML edit fails CI before a run.
36. As a developer, I want the deterministic-collection boundary preserved, so that fetching stays reproducible and debuggable.

## Implementation Decisions

### Registry model

- A Source is exactly one ingestion endpoint. The registry schema is: file-level `category`, `priority`, `enabled`; entry-level `name`, `url`, `type`, optional `priority`, optional `include_prereleases`, optional `enabled`, optional `notes`.
- `SourceType` becomes `github_release | rss | json_feed | website`. `github_repo` and `mailing_list` are removed from the type union and from the registry.
- Enablement lives in the files. The pipeline configuration's `categories` list is removed; a file with `enabled: true` contributes its enabled entries and nothing else does.
- Dormant content (file disabled, or entry disabled) is retained but never collected and is not validated beyond YAML parsing.
- Priority resolves per entry: the entry's `priority` if present, otherwise the file's. This resolved value is what flows into Items and therefore into ranking and qualifying-item counting.
- `notes` are operator-only and are never forwarded to Enrichment.
- `changelog` and `cve_feed` fields are removed; a feed is a Source of its own.
- Source identity remains `category:name`, so state and Item ids are unchanged in shape.
- Validation runs before collection and aggregates every problem into a single thrown error: missing or duplicate category, unknown or missing type, missing name or URL, duplicate name within a category, duplicate canonical URL across enabled Sources, invalid priority. Invalid canonical URLs are compared using the same normalization as ranking dedupe.
- Fetch failures remain per-Source errors that do not abort the run, per ADR-0001.

### Adapters

- A feed adapter reads a Source and the window start, returns Items, and accepts an injected fetch implementation, matching the existing adapter shape.
- RSS/Atom parsing is delegated to a small XML parser dependency (`fast-xml-parser`), because Node has no XML parser and hand-rolled parsing would mishandle CDATA, entities, and namespaces. This is the only new runtime dependency.
- Feed mapping: title from the entry title (falling back to the Source name), URL from link, text from description/summary/content with markup stripped and truncated to the existing collector text limit, published date from the entry date, id from the entry GUID/id. Entries whose date is missing or unparseable are skipped.
- JSON Feed mapping is the same shape, using `items[].title`, `url`/`external_url`, `content_text`, `date_published`, and `id`.
- Feed Items are filtered against the window start by published date, the same way GitHub releases already are.
- The GitHub adapter always drops `draft` releases and drops `prerelease` releases unless the Source sets `include_prereleases: true`.
- Conditional requests: adapters that support validators return an `ETag` alongside their Items. The collector persists it per Source in state and sends `If-None-Match` on the next run. A `304` yields no Items and does not advance the Source's last-seen time.
- Per-Source item caps continue to apply to every adapter.
- `GITHUB_TOKEN` is required whenever at least one enabled Source is `github_release`. The check happens in the orchestration preflight, alongside the existing Notion environment check, so it is covered by the existing injected-environment seam. Dry runs require it too because they collect.
- The `website` adapter is unchanged and remains available as an escape hatch, though no enabled Source uses it after this change.
- Per-source state gains an optional `etag` field. Existing state files remain valid.

### Registry inventory

- **cloud-native-k8s**: remove the KEPs repository Source and Kasten K10; add `runc`, `ingress-nginx`, the Kubernetes CVE JSON Feed, `crun`, `gVisor`, `Kata Containers`, `Traefik`, Gateway API, SPIFFE/SPIRE, KubeArmor, Tracee, security-profiles-operator, and the Kubernetes and CNCF blog feeds; demote Apple Container, Kustomize, Skaffold, and Tilt to MEDIUM.
- **security-tools**: move Checkov to compliance-scanning; add SOPS, Sealed Secrets, Kubewarden, sigstore, SLSA, in-toto, trivy-operator, and Harbor.
- **compliance-scanning**: keep KubeBench, Kubescape, and Checkov; remove the NVD pages, the Linux CVE NVD query, the CNCF Security TAG repository, and the Kubernetes security-announce mailing list.
- **ci-cd-gitops**: move Jenkins, GitLab CI, and GitHub Actions to their RSS feeds; add Jenkins security advisories at CRITICAL; demote Argo Rollouts to MEDIUM.
- **container-build**: remove Kaniko (archived).
- **Dormant files** (infrastructure-as-code, infrastructure-databases, observability) gain `enabled: false` and keep their entries unchanged.
- The exact per-file table is in the design document. Remaining gaps (compliance-scanning and container-build lacking an advisory-grade Source, and no global vulnerability feed) are recorded as follow-ups, not silently filled.

### Documentation

- The glossary's Source type, Priority, Enabled source, and Dormant entries describe the model above.
- The operator documentation states that `GITHUB_TOKEN` is required for runs, not optional.

## Testing Decisions

A good test here exercises observable behaviour through a public seam, with no network access and no assertions about internal helper structure. The existing suite already does this: adapters are driven with an injected fetch and recorded payloads, and orchestration is driven with injected collaborators.

Three seams, all existing:

1. **Configuration loader** — called against fixture registry directories. Covers enablement resolution, priority resolution, canonical-URL duplicate detection, unknown/removed types, duplicate names and categories, removal of the category list, and the aggregate error. Also used for a smoke test that loads the repository's real registry and asserts it validates.
2. **Collector adapters** — `collectGitHub` plus new RSS and JSON Feed adapters, each with an injected fetch. Covers parsing, date filtering, id assignment, draft/prerelease filtering, the prerelease override, validator capture, and `304` handling.
3. **Pipeline orchestration** — unchanged, except for the `GITHUB_TOKEN` preflight. Existing tests gain a token in their injected environment; new cases cover the missing-token failure and its absence in a registry with no GitHub Sources.

Prior art: `tests/collector.test.ts` (injected fetch, recorded payloads, error responses), `tests/pipeline.test.ts` (injected dependencies and environment), `tests/rank.test.ts` (dedupe and priority ordering).

Specific cases to add:

- A fixture registry with one enabled and one disabled file yields only the enabled Sources.
- A per-source priority override wins over the file default; an entry without one inherits the file's.
- Two enabled Sources with the same canonical URL (including trailing slash and case differences) produce a validation error; the same URL under a disabled entry or file does not.
- An entry with a retired type (`github_repo`, `mailing_list`) fails with a message naming the type.
- A missing `enabled` is treated as enabled; an explicit `false` at file level suppresses entries even if they are enabled individually.
- RSS and Atom fixtures produce Items with the expected id, title, URL, text, and published date; undated entries are skipped; entries before the window are excluded.
- A JSON Feed fixture modelled on the Kubernetes CVE feed produces one Item per entry.
- GitHub fixtures with `draft` and `prerelease` releases produce only published, non-prerelease Items by default, and include prereleases when the Source opts in.
- The GitHub adapter sends `If-None-Match` when given a validator and returns no Items on `304` without changing the Source's last-seen time.
- `runPipeline` fails loudly when a GitHub Source is enabled and `GITHUB_TOKEN` is missing; it does not require it when no GitHub Source is enabled.
- Loading the real registry succeeds, which catches YAML typos and stale types in CI.

## Out of Scope

- Global vulnerability feeds (OSV, NVD JSON, CISA KEV) and distro advisory feeds; the compliance-scanning and container-build advisory gaps stay recorded rather than closed.
- Restoring Linux kernel CVE coverage lost with the NVD query pages.
- Changes to cadence, digest window, ranking semantics, enrichment, rendering, Notion publishing, or the CLI surface.
- Rate-limit caching beyond per-Source ETag/`If-None-Match`.
- Granting `website` Sources conditional requests; the hash check already avoids duplicate Items.
- Creating the implementation tickets from this spec.

## Further Notes

- ADR-0004 records why one endpoint per Source and adapter-typed Sources were chosen over content-kind types and multi-endpoint entries.
- ADR-0001's boundary still holds: collection stays deterministic and model-free; only the adapter set and the registry schema change.
- The design document carries the full per-file inventory and the rationale for each removal, including the archived Kaniko repository and the feed-less Kasten page.
- `GITHUB_TOKEN` moves from "optional convenience" in the environment example to a required precondition for any run that includes GitHub Sources.
