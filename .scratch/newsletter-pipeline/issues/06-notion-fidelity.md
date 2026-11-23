# 06: Notion page fidelity and failure buffering

**What to build:** The published page follows the full digest layout, respects Notion's block and rate limits, buffers a digest when publishing fails, and reports partial failure through a non-zero exit.

**Blocked by:** 02

**Status:** resolved

- [x] The page contains the title heading, summary callout, top stories, per-category headings, red callouts for CRITICAL Items, item toggles with bookmarks, omitted count and footer
- [x] Content is created in a first batch and appended in chunks of one hundred blocks
- [x] Rate-limit and overload responses are retried with the server delay
- [x] A failed publish writes the digest to a pending area and the process exits non-zero
- [x] A partial collection failure also yields a non-zero exit
