import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupe, rank, selectForDigest } from "../src/rank";
import type { EnrichedItem } from "../src/types";

function item(overrides: Partial<EnrichedItem>): EnrichedItem {
  return {
    id: "id",
    sourceKey: "cat:src",
    sourceName: "src",
    category: "cat",
    priority: "HIGH",
    type: "github_release",
    title: "title",
    url: "https://example.com/a",
    publishedAt: "2026-01-01T00:00:00.000Z",
    text: "",
    qualifying: true,
    severity: 3,
    summary: "summary",
    whyItMatters: "",
    ...overrides,
  };
}

test("dedupe removes matching canonical urls", () => {
  const kept = dedupe([
    item({ id: "1", url: "https://example.com/a/" }),
    item({ id: "2", url: "https://example.com/a" }),
  ]);
  assert.equal(kept.length, 1);
});

test("dedupe removes matching normalized titles", () => {
  const kept = dedupe([
    item({ id: "1", title: "Release: v1.0", url: "https://example.com/a" }),
    item({ id: "2", title: "release v1 0", url: "https://example.com/b" }),
  ]);
  assert.equal(kept.length, 1);
});

test("rank orders by priority then severity", () => {
  const ranked = rank([
    item({ id: "low", priority: "MEDIUM", severity: 5 }),
    item({ id: "crit", priority: "CRITICAL", severity: 3 }),
    item({ id: "high", priority: "HIGH", severity: 4 }),
  ]);
  assert.deepEqual(ranked.map((entry) => entry.id), ["crit", "high", "low"]);
});

test("select caps results and reports omissions", () => {
  const selected = selectForDigest(
    [
      item({ id: "1", title: "one", url: "https://example.com/1" }),
      item({ id: "2", title: "two", url: "https://example.com/2" }),
      item({ id: "3", title: "three", url: "https://example.com/3" }),
    ],
    2,
  );
  assert.equal(selected.items.length, 2);
  assert.equal(selected.omitted, 1);
});
