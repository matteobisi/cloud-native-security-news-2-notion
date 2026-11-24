import assert from "node:assert/strict";
import { test } from "node:test";
import { enrich } from "../src/enrich";
import type { FetchLike, Item, PipelineConfig } from "../src/types";

function config(): PipelineConfig {
  return {
    cadence: {
      minQualifyingItems: 3,
      forcePublishAfterDays: 30,
      maxWindowDays: 35,
      bootstrapWindowDays: 7,
    },
    limits: { maxItemsPerDigest: 25, maxItemsPerSource: 10 },
    model: {
      baseUrl: "http://localhost:12434/engines/v1",
      name: "ai/gemma3:12b-q4_K_M",
      temperature: 0.2,
      maxTokens: 4096,
    },
    securitySignals: ["CVE-", "vulnerability"],
    paths: { sourcesDir: "config/sources", stateDir: "state" },
  };
}

function item(overrides: Partial<Item>): Item {
  return {
    id: "id",
    sourceKey: "cloud-native-k8s:example",
    sourceName: "example",
    category: "cloud-native-k8s",
    priority: "HIGH",
    type: "github_release",
    title: "title",
    url: "https://example.com/a",
    publishedAt: "2026-03-30T00:00:00.000Z",
    text: "",
    ...overrides,
  };
}

/** A fetch that answers the chat-completions endpoint with the given content. */
function modelFetch(content: string): FetchLike {
  return async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content,
      headers: new Headers(),
    }) as unknown as Response;
}

test("applies the model judgements to screened candidates", async () => {
  const warnings: string[] = [];
  const result = await enrich(
    [item({ id: "a", title: "Release v2.0", text: "fixes CVE-2026-1234" })],
    config(),
    {
      warn: (line) => warnings.push(line),
      fetchImpl: modelFetch(
        JSON.stringify([
          {
            id: "a",
            qualifying: true,
            severity: 5,
            summary: "Patches a critical vulnerability.",
            whyItMatters: "Remote exploitation is possible.",
          },
        ]),
      ),
    },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].qualifying, true);
  assert.equal(result[0].severity, 5);
  assert.equal(result[0].summary, "Patches a critical vulnerability.");
  assert.equal(result[0].whyItMatters, "Remote exploitation is possible.");
  assert.deepEqual(warnings, []);
});

test("applies qualifying=false judgements from the model", async () => {
  const result = await enrich(
    [item({ id: "a", title: "Release v2.0", text: "fixes CVE-2026-1234" })],
    config(),
    {
      fetchImpl: modelFetch(
        JSON.stringify([
          { id: "a", qualifying: false, severity: 1, summary: "Routine.", whyItMatters: "" },
        ]),
      ),
    },
  );

  assert.equal(result[0].qualifying, false);
  assert.equal(result[0].severity, 1);
});

test("falls back to rules when the model output is malformed", async () => {
  const warnings: string[] = [];
  const result = await enrich(
    [item({ id: "a", title: "Release v2.0", text: "fixes CVE-2026-1234" })],
    config(),
    {
      warn: (line) => warnings.push(line),
      fetchImpl: modelFetch("I am sorry, I cannot help with that."),
    },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].qualifying, true);
  assert.equal(result[0].severity, 4);
  assert.equal(result[0].summary, "Release v2.0");
  assert.equal(result[0].whyItMatters, "Matched security signals: CVE-");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /fell back to rules/);
});

test("falls back to rules when the model call throws", async () => {
  const warnings: string[] = [];
  const result = await enrich(
    [item({ id: "a", title: "Release v2.0", text: "fixes CVE-2026-1234" })],
    config(),
    {
      warn: (line) => warnings.push(line),
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].qualifying, true);
  assert.deepEqual(warnings, ["enrichment batch fell back to rules: connect ECONNREFUSED"]);
});

test("rule-based fallback maps severity from source priority", async () => {
  const result = await enrich(
    [
      item({ id: "crit", priority: "CRITICAL", title: "critical", url: "https://example.com/1" }),
      item({ id: "high", priority: "HIGH", title: "high", url: "https://example.com/2" }),
      item({ id: "med", priority: "MEDIUM", title: "medium", url: "https://example.com/3" }),
    ].map((entry) => ({ ...entry, text: "security vulnerability disclosed" })),
    config(),
    { fetchImpl: modelFetch("not json") },
  );

  assert.deepEqual(
    result.map((entry) => [entry.id, entry.severity]),
    [
      ["crit", 5],
      ["high", 4],
      ["med", 3],
    ],
  );
});

test("returns nothing when no item matches a security signal", async () => {
  const calls: string[] = [];
  const result = await enrich(
    [item({ id: "a", title: "New theme", text: "adds a dark mode" })],
    config(),
    {
      fetchImpl: async (url) => {
        calls.push(url);
        return modelFetch("[]")(url);
      },
    },
  );

  assert.deepEqual(result, []);
  assert.deepEqual(calls, []);
});
