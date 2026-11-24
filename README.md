# cloud-native-security-news-2-notion

Local-first pipeline that turns new releases and announcements from cloud-native security sources into a formatted Notion digest — using Docker Agent and Docker Model Runner, with no cloud model providers.

## How it works

1. **Collect** — deterministic TypeScript adapters read the sources in `config/sources/*.yaml` and normalize new entries into items.
2. **Enrich** — a keyword screen narrows candidates; Docker Model Runner (via Docker Agent) judges relevance, assigns severity, and writes summaries.
3. **Render** — the digest is published as a child page under a Notion parent page using the Notion REST API.

Collection is deterministic and the model only judges and writes, so runs are reproducible and failures are diagnosable.

## Requirements

- Docker Desktop with Docker Model Runner enabled (Docker 4.40+ on macOS; this project targets Docker 29 / Compose v5).
- Apple Silicon with ~32 GB unified memory (default model `ai/gemma3:12b-q4_K_M`, ~8.2 GB).
- A Notion integration token with insert-content permission, and a parent page shared with that integration.
- A GitHub token: required for any run that includes GitHub Sources, and it raises the API limit from 60 to 5,000 requests per hour.

## Setup

```sh
cp .env.example .env      # fill in NOTION_TOKEN, NOTION_PARENT_PAGE_ID and GITHUB_TOKEN
npm install
docker model pull ai/gemma3:12b-q4_K_M
```

## Usage

```sh
./newsletter run          # collect, enrich, publish
./newsletter dry-run      # print the digest without touching Notion or state
./newsletter reset        # clear local state
./newsletter build        # build the Docker image
./newsletter up           # run the Compose service
./newsletter schedule     # show LaunchAgent instructions
```

Directly, without Docker Agent:

```sh
npm run build && node dist/cli.js run --dry-run
```

## Scheduling

Runs are stateless from the operator's point of view: `scripts/run.sh` starts Docker Desktop, waits for the daemon, then invokes `docker agent run --exec agents/digest.yaml`. Install the printed LaunchAgent to run it daily.

## Configuration

- `config/sources/*.yaml` — Source registry. Each file is a Category and enables itself with `enabled`; each entry is one endpoint with a Source type (`github_release`, `rss`, `json_feed`, `website`). Priority defaults per file and can be overridden per Source.
- `config/pipeline.yaml` — cadence thresholds, item limits, model, security signals, paths.
- `.env` — secrets and model endpoint (gitignored). `GITHUB_TOKEN` is required whenever a GitHub Source is enabled.

## Cadence

A run publishes only when at least `minQualifyingItems` qualifying items are buffered, or when `forcePublishAfterDays` has elapsed. The digest window starts at the last published digest, capped at `maxWindowDays`. Skipped weeks roll forward.

## Tests

```sh
npm test          # unit + rendering tests
npm run typecheck
```

## Project docs

- `GLOSSARY.md` — domain vocabulary
- `docs/adr/` — architecture decisions
- `.scratch/newsletter-pipeline/` — spec and implementation tickets
- `docs/agents/` — agent-skill configuration
