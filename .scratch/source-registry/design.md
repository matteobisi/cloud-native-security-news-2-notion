# Design: Source registry and collector type coverage

Status: ready-for-agent
Feature: source-registry

## Scope

Improves `config/sources/*.yaml` and the collector's source-type coverage: the registry model,
the loader/collector fixes that make the current schema honest, and the concrete source inventory.
Implementation is a separate ticket. This document is the agreed design.

Supersedes the registry parts of `.scratch/newsletter-pipeline/spec.md` (implementation decisions
on `github_repo`, `mailing_list`, category enablement) and is recorded in ADR-0004.

## Problem

The registry contains entries the collector cannot honour and carries fields nothing reads:

- `mailing_list` sources are dropped at load time (`src/config.ts`), including the Kubernetes
  security-announce channel.
- `github_repo` is read through the GitHub releases endpoint, so `kubernetes/enhancements` and
  `cncf/tag-security` return `[]` forever.
- `cve_feed` and `changelog` are declared and consumed nowhere.
- Priority is per file, so Tilt/Skaffold/Kustomize are CRITICAL by inheritance.
- Website sources emit one item per whole-page hash change, which is the wrong shape for the
  changelog pages that have proper feeds.
- ~48 unauthenticated GitHub calls per run against a 60/hour limit leaves no headroom.
- Duplicate entries (Checkov, Linux CVEs) waste quota; archived and feed-less projects remain.

## Decisions

### D1 — A Source is exactly one ingestion endpoint

One YAML entry = one URL = one adapter. Feeds are not attachments to project entries; each feed is
its own Source. Consequence: the `changelog` and `cve_feed` fields are removed.

### D2 — Source type names the adapter, not the content

`Source type` is the adapter that reads the endpoint. Allowed set:

| Type | Reads |
|---|---|
| `github_release` | GitHub releases API for the repository in `url` |
| `rss` | RSS 2.0 / Atom feed |
| `json_feed` | JSON Feed 1.1 document |
| `website` | HTML page, hashed whole-page change detection (escape hatch) |

`mailing_list` and `github_repo` are retired. There is no `kind` field in v1: we do not add fields
until something consumes them.

### D3 — Enablement lives in the file

Every file carries `enabled: true|false`, and every Source may carry `enabled: true|false`.
`pipeline.categories` is removed as an enable list — one source of truth. Dormant content is
retained but never collected or validated beyond YAML parsing.

### D4 — Priority is a file default with a per-source override

`priority` at file level sets the default; an entry may override it. `notes` remain operator-only
documentation and are never sent to the model.

### D5 — GitHub prereleases are filtered at collection

`draft` releases are always dropped. `prerelease` releases are dropped unless the Source sets
`include_prereleases: true`. Filtering happens in the collector so state and `lastSeenId` stay
consistent with ADR-0001.

### D6 — Duplicate endpoints are a configuration error

Among enabled Sources, canonical URLs must be unique. `rank.ts` dedupe stays as a safety net for
buffered items, not as the mechanism for registry hygiene.

### D7 — Configuration errors are fatal; fetch errors are not

At load: unknown type, missing `name`/`url`/`type`, duplicate name within a category, duplicate
canonical URL across enabled Sources, non-unique `category`, or invalid `priority` → exit non-zero.
At collect: a Source failure is recorded and the run continues (unchanged, ADR-0001).

### D8 — GitHub access is authenticated and conditional

`GITHUB_TOKEN` is required for runs. GitHub requests use `ETag`/`If-None-Match`; a `304` response
does not consume the primary rate limit, so unchanged repositories are free.

### D9 — Coverage bar

An enabled project Source qualifies only if it (i) ships security-relevant change, (ii) exposes a
machine-readable changelog (release, tag, or feed), (iii) has shipped in the last ~12 months, and
(iv) needs no auth beyond `GITHUB_TOKEN`. Each enabled category should carry at least one
advisory/CVE-grade Source and at least three qualifying project Sources; deviations are recorded
below rather than filled with noise.

## Registry schema

```yaml
category: cloud-native-k8s      # required, unique across files
priority: CRITICAL              # default for entries in this file
enabled: true                   # dormant categories set false

sources:
  - name: runc
    url: https://github.com/opencontainers/runc/releases
    type: github_release        # github_release | rss | json_feed | website
    priority: CRITICAL          # optional override
    include_prereleases: false  # optional, github_release only
    enabled: true               # optional, parks one Source without deleting it
    notes: "operator-only"      # never sent to the model
```

## Coverage bar application

- **Precision over recall.** The digest is a reading artifact, not a vulnerability database. A
  weekly issue is capped at 25 items, so a missed low-signal tool release is cheaper than noise.
- **Machine-readable or out.** Whole-page hashing is retained only as an escape hatch; every
  enabled website Source is migrated or removed.
- **Stale is removed, not parked.** Sources failing (iii) move to `enabled: false` only if they are
  expected back; otherwise they are deleted and remain in git history.

## Inventory

### `cloud-native-k8s.yaml` — enabled, default CRITICAL

Keep (18): Kubernetes, Podman, CRI-O, Containerd, Docker (Moby), Istio, Linkerd, Cilium, Calico,
CoreDNS, cert-manager, trust-manager, Velero, Helm, Apple Container, Kustomize, Skaffold, Tilt.

Remove (2): Kubernetes KEPs (`github_repo`, endpoint returns no releases), Kasten K10 (`website`,
no machine-readable changelog).

Add (14):

| Name | Type | Priority | Endpoint |
|---|---|---|---|
| runc | github_release | CRITICAL | `opencontainers/runc` |
| ingress-nginx | github_release | CRITICAL | `kubernetes/ingress-nginx` |
| Kubernetes CVE feed | json_feed | CRITICAL | `kubernetes.io/docs/reference/issues-security/official-cve-feed/index.json` |
| crun | github_release | HIGH | `containers/crun` |
| gVisor | github_release | HIGH | `google/gvisor` |
| Kata Containers | github_release | HIGH | `kata-containers/kata-containers` |
| Traefik | github_release | HIGH | `traefik/traefik` |
| Gateway API | github_release | HIGH | `kubernetes-sigs/gateway-api` |
| SPIFFE/SPIRE | github_release | HIGH | `spiffe/spire` |
| KubeArmor | github_release | HIGH | `kubearmor/KubeArmor` |
| Tracee | github_release | HIGH | `aquasecurity/tracee` |
| security-profiles-operator | github_release | HIGH | `kubernetes-sigs/security-profiles-operator` |
| Kubernetes blog | rss | MEDIUM | `kubernetes.io/feed.xml` |
| CNCF blog | rss | MEDIUM | `cncf.io/blog/feed/` |

Priority demotions: Apple Container, Kustomize, Skaffold, Tilt → MEDIUM.

### `security-tools.yaml` — enabled, default CRITICAL

Keep (14): OpenBao, HashiCorp Vault, CyberArk Secrets Manager, External Secrets Operator, Boundary,
OPA, Kyverno, Gatekeeper, Trivy, Grype, Syft, Falco, Tetragon, Cosign.

Remove (1): Checkov (moves to `compliance-scanning` — one endpoint rule, and that category would
otherwise fall below the three-project minimum).

Add (8, all HIGH):

| Name | Type | Endpoint |
|---|---|---|
| SOPS | github_release | `getsops/sops` |
| Sealed Secrets | github_release | `bitnami-labs/sealed-secrets` |
| Kubewarden | github_release | `kubewarden/kubewarden` |
| sigstore | github_release | `sigstore/sigstore` |
| SLSA | github_release | `slsa-framework/slsa` |
| in-toto | github_release | `in-toto/in-toto` |
| trivy-operator | github_release | `aquasecurity/trivy-operator` |
| Harbor | github_release | `goharbor/harbor` |

### `compliance-scanning.yaml` — enabled, default HIGH

Keep (3): KubeBench, Kubescape, Checkov (moved in).

Remove (4): NIST NVD and Linux CVEs (whole-page hash, no per-CVE items), CNCF Security TAG
(`github_repo`, dead endpoint), Kubernetes Security Announcements (`mailing_list`, replaced by the
Kubernetes CVE `json_feed` in `cloud-native-k8s`).

No additions. See open item O1.

### `ci-cd-gitops.yaml` — enabled, default HIGH

Keep (8): Jenkins, GitLab CI, GitHub Actions, Tekton Pipelines, ArgoCD, Flux, Argo Workflows,
Argo Rollouts.

Migrations:

| Source | From | To |
|---|---|---|
| Jenkins | website `jenkins.io/changelog/` | rss `jenkins.io/changelog-stable/rss.xml` |
| GitLab CI | website `about.gitlab.com/releases/...` | rss `about.gitlab.com/atom.xml` |
| GitHub Actions | website `github.blog/changelog/label/actions/` | rss `github.blog/changelog/label/actions/feed/` |

Add (1): Jenkins security advisories — rss `jenkins.io/security/advisories/rss.xml`, CRITICAL.

Priority demotion: Argo Rollouts → MEDIUM. Caveat: the GitLab atom feed covers all GitLab
releases, not only CI; accepted because it still beats whole-page hashing.

### `container-build.yaml` — enabled, default HIGH

Keep (4): Buildah, BuildKit, APKO, Melange.

Remove (1): Kaniko (repository archived 2025-06-03, fails the coverage bar).

No additions. See open item O2.

### Dormant files

`infrastructure-as-code.yaml`, `infrastructure-databases.yaml`, `observability.yaml` gain
`enabled: false` and keep their entries unchanged. They are not validated beyond YAML parsing, so
their existing `website` entries and the duplicated Linux CVEs entry are inert.

## Known gaps and follow-ups

- **O1 — `compliance-scanning` has no advisory-grade Source.** After removals it holds three
  project Sources (KubeBench, Kubescape, Checkov) and no CVE feed, violating D9's first half. The
  natural closure is a distro or global advisory feed (Ubuntu USN, Debian DSA, Red Hat security
  data, OSV). That needs an adapter beyond the v1 set, or verified RSS endpoints; not decided here.
- **O2 — `container-build` has no advisory-grade Source.** Accepted: build tools publish security
  fixes through the same release channels already covered. Recorded, not silently ignored.
- **O3 — no global vulnerability feed.** NVD/OSV/CISA KEV are out of scope for this design. The
  Kubernetes CVE `json_feed` covers cluster CVEs; broader coverage is a future adapter decision.
- **O4 — Linux kernel CVE coverage regressed.** Removing the NVD query pages means kernel CVEs
  arrive only through project release notes until O3 is addressed. Accepted for a
  precision-leaning digest.

## Not changed by this design

- Cadence, ranking, enrichment, rendering, and Notion publishing.
- `website` remains an allowed type even though no enabled Source uses it.
- ADR-0001's deterministic-collection boundary.
