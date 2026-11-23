# Run locally on Docker Model Runner

All model inference runs against Docker Model Runner on the operator's Apple Silicon workstation; no cloud model provider is used. This keeps potentially sensitive advisory and release text on-device and removes token costs, at the price of tying runs to a machine where Docker Desktop is running.

## Consequences

- Digest runs cannot happen while Docker Desktop is stopped; the schedule must start Docker first or accept missed runs.
- Model choice is bounded by ~32 GB of unified memory.
