# Spec: Docker Agent entrypoint

Status: ready-for-agent
Feature: docker-agent-entrypoint
Related: ADR-0005, ADR-0001, ADR-0003

## Problem Statement

The operator wants `./newsletter run` to be Docker Agent, with Docker Model Runner for inference and everything else in Docker Compose. The current agent route does not actually run anything: under `--safety restricted` the shell tool refuses the `node` command as unsafe, and gemma3 frequently emits the command inside a `tool_code` fence instead of calling the tool. The agent then exits 0, the wrapper trusts the exit code, and no Digest is published. Attempting to use a second, more reliable model for the agent while gemma stays resident for Enrichment exhausted GPU memory and broke the model runner until Docker Desktop was restarted. The result is a run command that looks successful and silently does nothing.

## Solution

Make `./newsletter run` always launch Docker Agent, with the agent's single job being to invoke the deterministic pipeline inside the Compose `digest` service. The agent runs with autonomous tool approval and uses qwen2.5-14b-instruct, which Docker Model Runner also serves for Enrichment, so only one model is resident. The pipeline writes a run marker on every run, and the wrapper refuses to report success unless that marker changed — turning a silent no-op into a loud failure. Direct Compose invocation moves to an explicit debug command, and scheduled runs use the same agent route.

## User Stories

1. As a security practitioner, I want `./newsletter run` to be Docker Agent, so that the project's stated entrypoint is the one I actually use.
2. As a security practitioner, I want the agent to invoke the pipeline in a container, so that I do not need Node or a local build on the host.
3. As a security practitioner, I want the agent to run with autonomous tool approval, so that its shell call is not denied as unsafe.
4. As a security practitioner, I want the agent to use a model that reliably calls tools, so that the command is executed rather than printed.
5. As a security practitioner, I want the agent's instruction to name one exact command, so that autonomous approval cannot drift into other actions.
6. As a security practitioner, I want the agent to receive no collected content, so that feed text cannot steer the tools it runs.
7. As a security practitioner, I want the agent and Enrichment to share one model, so that Docker Model Runner never holds two models and exhausts GPU memory.
8. As a security practitioner, I want that model to be qwen2.5-14b-instruct, so that tool calls are dependable and JSON output is usable.
9. As a security practitioner, I want the pipeline container rebuilt before each run, so that it always matches the checked-out code.
10. As a security practitioner, I want a run marker written on every run, so that success can be verified independently of the model's transcript.
11. As a security practitioner, I want `./newsletter run` to fail when the marker did not change, so that a silent no-op is impossible to miss.
12. As a security practitioner, I want the failure message to say the agent never executed the pipeline, so that I know where to look.
13. As a security practitioner, I want the marker to record status, exit code and timestamps, so that I can diagnose a run after the fact.
14. As a security practitioner, I want a failed or partial run still recorded, so that the marker never claims success falsely.
15. As a security practitioner, I want the marker to live in the state volume, so that it is visible from both host and container.
16. As a security practitioner, I want scheduled runs to go through the same agent route, so that they are identical to manual runs.
17. As a security practitioner, I want the scheduler to start Docker Desktop and wait for the daemon first, so that the agent has a working Docker socket.
18. As a security practitioner, I want a separate debug command that invokes Compose directly, so that I can isolate pipeline failures from agent failures.
19. As a security practitioner, I want `run` to never fall back to the debug command silently, so that the agent route is genuinely exercised.
20. As a security practitioner, I want dry runs and reset to keep working through Compose, so that the operational commands remain unchanged.
21. As a security practitioner, I want the README to show the qwen model pull and the new usage, so that setup matches reality.
22. As a security practitioner, I want the requirements to reflect one resident model, so that I can size the machine correctly.
23. As a security practitioner, I want the architecture decision recorded, so that a future reader understands why autonomous approval and qwen exist.
24. As a developer, I want the run marker persisted through the state store, so that its read/write logic is testable without Docker.
25. As a developer, I want the existing pipeline seam untouched, so that collector, Enrichment and rendering tests keep passing unchanged.
26. As a developer, I want a documented smoke check for the agent route, so that the untestable part has a repeatable manual verification.
27. As a developer, I want the agent route's failure modes documented, so that a denial or model regression is diagnosed quickly.

## Implementation Decisions

### Entrypoint and commands

- The wrapper's `run` command always executes Docker Agent with `--exec` and `--safety autonomous`, passing the agent configuration and a message that starts the run. It never invokes Compose directly.
- The agent configuration names qwen2.5-14b-instruct and exposes the shell and think toolsets. Its instruction is to run exactly one command with the shell tool and then stop:
  `docker compose run --rm --build digest node dist/cli.js run`.
- The direct Compose invocation becomes `./newsletter debug-run`, explicitly labelled as a debug path. `dry-run`, `reset`, `schedule`, `build` and `up` keep their current Compose behaviour.
- `./newsletter run` no longer builds the host `dist/`; the container build covers it.
- The scheduled launcher starts Docker Desktop, waits for `docker info`, then invokes the same `run` command, inheriting the marker check.

### Single model

- `pipeline.yaml`, the Compose `models:` block, the agent configuration and the environment example all point at qwen2.5-14b-instruct.
- README setup pulls that model and the requirements describe one resident model.
- Node-based local runs (`npm run dry-run`) use the same configured model.

### Run marker

- The CLI writes a run marker into the state directory at the end of every `run`, including when the pipeline throws or publishing fails.
- The marker records at least: a unique run id, start and finish timestamps, the pipeline status and the exit code. It is written atomically enough that a reader never sees partial JSON; a corrupt or missing marker is treated as absent.
- The marker functions live in the state store alongside the existing state persistence, so they are unit-testable at the existing seam.
- The wrapper hashes the marker before launching the agent and again after it exits. If the hash is unchanged, the wrapper prints an explicit failure saying the agent did not execute the pipeline and exits non-zero.
- Dry runs and reset do not write the marker.

### Documentation

- ADR-0005 records the entrypoint, autonomous approval, single-model choice and marker verification, with the rejected alternatives.
- README reflects the new command set, the qwen pull, and the debug route.
- The glossary is unchanged: **Enrichment** still means the model-driven judging step, regardless of who invokes it.

## Testing Decisions

A good test verifies observable behaviour through a public seam and does not depend on internals. For this feature almost everything is integration-shaped; only marker persistence has a meaningful unit seam.

- **State store seam (existing, covered by the current state tests):** round-trip a marker, overwrite an older marker with a newer run id, treat a missing file as absent, treat corrupt JSON as absent, and write a marker for a failed status.
- **Pipeline seam (existing, unchanged):** no new tests; the run result already carries status and exit code, and the marker simply records them.
- **Registry and adapter seams:** untouched, existing suite must stay green.
- **Integration smoke (manual, documented):** run `./newsletter run`, assert exit 0 and that the marker changed; then run it with the agent interrupted or with Docker Agent's tool usage disabled to confirm the wrapper fails when the marker is unchanged. This is the only place the agent/Compose/Docker Model Runner chain is exercised.

Prior art: state persistence and corrupt-file handling already tested in the state tests; the pipeline tests already assert status and exit codes that the marker mirrors.

## Out of Scope

- Changing Enrichment to be agent-orchestrated (the agent running the model loop itself); the deterministic pipeline stage remains.
- Session-start hooks, command allowlists, or other ways to keep restricted safety.
- Multi-model deployment or model eviction tuning.
- Changing collector, enrichment, ranking, rendering or Notion behaviour.
- Non-macOS scheduling.

## Further Notes

- Verified during design: restricted safety denies the `node` command; gemma3 intermittently emits a fake `tool_code` fence and exits 0; qwen2.5-14b-instruct executed the shell tool reliably under autonomous safety; two models resident caused a Metal OOM and left the runner in an error state until Docker Desktop restarted.
- qwen's judgement quality for Enrichment is the main risk. If it regresses, the documented fallback is gemma for Enrichment plus the session-start-hook route for the agent, recorded as a new ADR rather than an ad-hoc change.
- The marker is an operator artefact as well as a wrapper check; scheduled runs leave a trail of statuses in the state directory.
