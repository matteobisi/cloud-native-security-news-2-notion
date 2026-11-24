# cloud-native-security-news-2-notion

Local-first pipeline that turns new releases and announcements from cloud-native security sources into a formatted Notion digest — using Docker Agent, Docker Compose and Docker Model Runner, with no cloud model providers.

## How it works

1. **Collect** — deterministic TypeScript adapters read the sources in `config/sources/*.yaml` and normalize new entries into items.
2. **Enrich** — a keyword screen narrows candidates; Docker Model Runner judges relevance, assigns severity, and writes summaries.
3. **Render** — the digest is published as a child page under a Notion parent page using the Notion REST API.

Collection is deterministic and the model only judges and writes, so runs are reproducible and failures are diagnosable.

## Requirements

- Docker Desktop with Docker Model Runner enabled (Docker 4.40+ on macOS; this project targets Docker 29 / Compose v5).
- Apple Silicon with ~32 GB unified memory (default model `qwen2.5-14b-instruct`, ~8.4 GB). One model is resident at a time; Docker Model Runner serves it for both the agent and Enrichment.
- A Notion integration token with insert-content permission, and a parent page shared with that integration.
- A GitHub token: required for any run that includes GitHub Sources, and it raises the API limit from 60 to 5,000 requests per hour.

## Setup

```sh
cp .env.example .env      # fill in NOTION_TOKEN, NOTION_PARENT_PAGE_ID and GITHUB_TOKEN
npm install               # optional; only needed for local tooling
docker model pull huggingface.co/bartowski/qwen2.5-14b-instruct-gguf:latest
```

## Usage

```sh
./newsletter run          # Docker Agent entrypoint: collect, enrich, publish
./newsletter debug-run    # bypass Docker Agent and invoke Compose directly
./newsletter dry-run      # print the digest without touching Notion or state
./newsletter reset        # clear local state
./newsletter build        # build the Docker image
./newsletter up           # run the Compose service
./newsletter schedule     # show LaunchAgent instructions
```

Directly, without Docker:

```sh
npm run build && node dist/cli.js run --dry-run
```

## Scheduling

Runs are stateless from the operator's point of view: `scripts/run.sh` starts Docker Desktop, waits for the daemon, then invokes `./newsletter run`, so scheduled runs use the same Docker Agent entrypoint as manual runs. Install the printed LaunchAgent to run it daily.

## Verification and troubleshooting

Every `./newsletter run` writes `state/last-run.json` with the run id, timestamps, status and exit code. The wrapper only reports success when that file carries the run id it started, so an agent that never executed the pipeline fails loudly instead of exiting 0.

- If the agent reports a denied tool, its safety mode is wrong.
- If it reports a timeout, the agent must pass a long timeout to the shell tool; the pipeline runs for minutes.
- `./newsletter debug-run` invokes the pipeline without the agent, to separate pipeline failures from agent failures.
- An existing `.env` from before the model change still overrides the pipeline default: set `MODEL_NAME` to the qwen model above.

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
