# Docker Agent is the run entrypoint

`./newsletter run` always launches `docker agent run`; the agent's only job is to invoke the deterministic pipeline, which runs in the Compose `digest` service via `docker compose run --rm --build digest node dist/cli.js run`. Docker Model Runner stays the sole inference backend, serving one model — qwen2.5-14b-instruct — for both the agent loop and Enrichment, so only one model is resident at a time. The agent runs with `--safety autonomous`, and the shell wrapper detects a silent no-op by requiring the pipeline's run marker to change.

## Considered Options

- **Compose invoked directly by `./newsletter run`** (the previous fix). Reliable, but it bypasses Docker Agent, which is the project's stated front door.
- **Keep `--safety restricted`.** Verified to deny the `node` command outright: the call is not classified safe and the restricted fallback denies instead of asking, so the agent never executes the pipeline.
- **gemma3 as the agent model.** Verified unreliable at tool use: it often emits the command inside a fake `tool_code` fence instead of calling the shell tool, exiting 0 without running anything.
- **Session-start hook that runs the pipeline deterministically** while the agent only reports. Reliable under restricted safety, but the agent stops being what drives the run, and the model's role becomes decorative.
- **qwen for the agent and gemma for Enrichment.** Keeps the default enrichment model, but both models stay resident while the CLI runs; this OOM'd the Metal backend once (`Compute error`, backend in error state) and required restarting Docker Desktop.

## Consequences

- The agent receives only its static instruction — no feed or advisory text — so the autonomous approval cannot be steered by collected content.
- Enrichment model choice is now qwen2.5-14b-instruct; its judgement quality must be validated, with the hook route as the fallback if quality regresses.
- The operator needs the qwen model pulled instead of gemma3; README requirements and the Compose `models:` block follow this ADR.
- A run is only considered successful when the run marker changes; an agent that exits 0 without executing now fails loudly.
- Scheduled runs use the same agent route as manual runs; the direct Compose invocation remains available as an explicit debug command.
- ADR-0001 is unchanged: collection stays deterministic and model-free; only the entrypoint and the model identity change.
