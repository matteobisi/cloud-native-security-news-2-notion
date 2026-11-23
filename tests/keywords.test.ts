import assert from "node:assert/strict";
import { test } from "node:test";
import { screenItems } from "../src/enrich/keywords";
import type { Item } from "../src/types";

function item(id: string, title: string, text = ""): Item {
  return {
    id,
    sourceKey: "cat:src",
    sourceName: "src",
    category: "cat",
    priority: "HIGH",
    type: "github_release",
    title,
    url: `https://example.com/${id}`,
    publishedAt: "2026-01-01T00:00:00.000Z",
    text,
  };
}

test("screen keeps items with a security signal", () => {
  const result = screenItems(
    [
      item("a", "Release v2.0", "fixes CVE-2026-1234"),
      item("b", "Release v2.1", "adds a new theme"),
    ],
    ["CVE-", "vulnerability"],
  );
  assert.deepEqual(result.candidates.map((entry) => entry.id), ["a"]);
  assert.deepEqual(result.matches.get("a"), ["CVE-"]);
});

test("screen is case-insensitive", () => {
  const result = screenItems([item("a", "Security patch")], ["security"]);
  assert.equal(result.candidates.length, 1);
});
