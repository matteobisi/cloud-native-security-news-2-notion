import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBlocks, groupByCategory } from "../src/render/notion";
import type { Digest, EnrichedItem } from "../src/types";

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
    whyItMatters: "why",
    ...overrides,
  };
}

function digest(items: EnrichedItem[]): Digest {
  return {
    title: "Digest",
    date: "2026-01-02T00:00:00.000Z",
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2026-01-02T00:00:00.000Z",
    items,
    omitted: 0,
    sourcesScanned: 2,
    model: "ai/gemma3:12b-q4_K_M",
  };
}

test("buildBlocks starts with the title heading and a summary callout", () => {
  const blocks = buildBlocks(digest([item({})]));
  assert.equal(blocks[0].type, "heading_1");
  assert.equal(blocks[1].type, "callout");
});

test("critical items produce a red callout", () => {
  const blocks = buildBlocks(
    digest([item({ priority: "CRITICAL" }), item({ id: "2", url: "https://example.com/b" })]),
  );
  const red = blocks.filter(
    (block) => block.type === "callout" && (block.callout as { color: string }).color === "red_background",
  );
  assert.equal(red.length, 1);
});

test("a severity 5 item from a non-critical source produces a red callout", () => {
  const blocks = buildBlocks(
    digest([
      item({ id: "1", priority: "HIGH", severity: 5, title: "urgent", url: "https://example.com/1" }),
      item({ id: "2", priority: "HIGH", severity: 4, title: "routine", url: "https://example.com/2" }),
    ]),
  );
  const red = blocks.filter(
    (block) => block.type === "callout" && (block.callout as { color: string }).color === "red_background",
  );
  assert.equal(red.length, 1);
  const content = (red[0].callout as { rich_text: Array<{ text: { content: string } }> })
    .rich_text[0].text.content;
  assert.ok(content.startsWith("urgent:"));
});

test("a critical item is called out even when its severity is low", () => {
  const blocks = buildBlocks(digest([item({ priority: "CRITICAL", severity: 2 })]));
  const red = blocks.filter(
    (block) => block.type === "callout" && (block.callout as { color: string }).color === "red_background",
  );
  assert.equal(red.length, 1);
});

test("each item becomes a toggle with a bookmark child", () => {
  const blocks = buildBlocks(digest([item({})]));
  const toggle = blocks.find((block) => block.type === "toggle") as {
    toggle: { children: Array<{ type: string }> };
  };
  assert.ok(toggle);
  assert.ok(toggle.toggle.children.some((child) => child.type === "bookmark"));
});

test("groupByCategory groups preserving order", () => {
  const groups = groupByCategory([
    item({ id: "1", category: "b" }),
    item({ id: "2", category: "a" }),
  ]);
  assert.deepEqual(groups.map(([name]) => name), ["b", "a"]);
});

test("includes top stories and a footer with the window and model", () => {
  const blocks = buildBlocks(
    digest([
      item({ id: "1", title: "first", url: "https://example.com/1" }),
      item({ id: "2", title: "second", url: "https://example.com/2" }),
    ]),
  );
  const headings = blocks
    .filter((block) => block.type === "heading_2")
    .map((block) => (block.heading_2 as { rich_text: Array<{ text: { content: string } }> })
      .rich_text[0].text.content);
  assert.ok(headings.includes("Top stories"));

  const footer = blocks.at(-1) as { paragraph: { rich_text: Array<{ text: { content: string } }> } };
  const text = footer.paragraph.rich_text[0].text.content;
  assert.ok(text.includes("Window:"));
  assert.ok(text.includes("Model:"));
});

test("reports omitted items when the cap trims the digest", () => {
  const withOmitted = { ...digest([item({})]), omitted: 7 };
  const blocks = buildBlocks(withOmitted);
  const texts = blocks
    .filter((block) => block.type === "paragraph")
    .map((block) => (block.paragraph as { rich_text: Array<{ text: { content: string } }> })
      .rich_text[0].text.content);
  assert.ok(texts.some((text) => text.includes("7 additional qualifying items")));
});
