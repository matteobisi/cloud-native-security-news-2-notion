# Publish to Notion through the REST API, not MCP

The pipeline writes digests with Notion's REST API (`Notion-Version: 2026-03-11`) using an integration token. We rejected Notion's hosted MCP server because unattended operation would require OAuth or a Business/Enterprise MCP token, and we rejected the local `@notionhq/notion-mcp-server` because Notion has marked it unmaintained. The REST API is deterministic, works on any plan, and keeps the container free of an extra protocol hop.

## Consequences

- The Notion integration must be shared with the digest's parent page, and must hold insert-content permission.
- Requests must respect the append limit (100 children per call) and back off on 429/529.
