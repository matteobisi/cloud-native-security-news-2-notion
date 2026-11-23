# 07: Operator entrypoints and packaging

**What to build:** A non-coder can run, preview, reset, build and schedule the pipeline through one entrypoint, with Docker Agent and Docker Model Runner wired up and setup documented.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] The operator entrypoint exposes run, dry-run, reset, build, up and schedule
- [ ] The scheduled runner starts Docker Desktop, waits for the daemon and invokes the Docker Agent
- [ ] The Compose service wires a model block for Docker Model Runner and the image builds
- [ ] Secrets example, pipeline configuration and README setup are present and accurate
