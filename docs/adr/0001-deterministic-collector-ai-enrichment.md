# Separate deterministic collection from model enrichment

Collection (fetching and normalizing sources) runs as deterministic code so runs are reproducible, debuggable, and cheap to retry; the model only judges relevance, ranks items, and writes summaries. We rejected a fully agentic pipeline where the model drives fetching and Notion writes, because I/O failures would become nondeterministic and hard to diagnose, and because deterministic fetching keeps latency and cost bounded.

## Consequences

- The model's inputs are always a normalized item list, so prompt changes can be replayed against stored state.
- Source adapters can be tested without a model or network.
