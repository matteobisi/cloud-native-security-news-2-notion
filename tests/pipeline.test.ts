import assert from "node:assert/strict";
import { test } from "node:test";
import { runPipeline, type PipelineDeps } from "../src/pipeline";
import type { State } from "../src/state/store";
import type {
  Digest,
  EnrichedItem,
  Item,
  PipelineConfig,
  SourceConfig,
} from "../src/types";

const NOW = new Date("2026-03-31T00:00:00.000Z");

function pipelineConfig(overrides: Partial<PipelineConfig["cadence"]> = {}): PipelineConfig {
  return {
    categories: ["cloud-native-k8s"],
    cadence: {
      minQualifyingItems: 3,
      forcePublishAfterDays: 30,
      maxWindowDays: 35,
      bootstrapWindowDays: 7,
      ...overrides,
    },
    limits: { maxItemsPerDigest: 25, maxItemsPerSource: 10 },
    model: {
      baseUrl: "http://localhost:12434/engines/v1",
      name: "ai/gemma3:12b-q4_K_M",
      temperature: 0.2,
      maxTokens: 4096,
    },
    securitySignals: ["CVE-"],
    paths: { sourcesDir: "config/sources", stateDir: "state" },
  };
}

const SOURCES: SourceConfig[] = [
  {
    key: "cloud-native-k8s:example",
    name: "example",
    url: "https://github.com/example/example",
    type: "github_release",
    category: "cloud-native-k8s",
    priority: "CRITICAL",
  },
];

function item(overrides: Partial<Item>): Item {
  return {
    id: "id",
    sourceKey: "cloud-native-k8s:example",
    sourceName: "example",
    category: "cloud-native-k8s",
    priority: "CRITICAL",
    type: "github_release",
    title: "title",
    url: "https://example.com/a",
    publishedAt: "2026-03-30T00:00:00.000Z",
    text: "",
    ...overrides,
  };
}

function enriched(overrides: Partial<EnrichedItem>): EnrichedItem {
  return {
    ...item(overrides),
    qualifying: true,
    severity: 4,
    summary: "summary",
    whyItMatters: "why",
    ...overrides,
  };
}

interface HarnessOptions {
  state?: Partial<State>;
  collected?: Item[];
  collectErrors?: string[];
  scanned?: number;
  enriched?: EnrichedItem[];
  publishFails?: boolean;
  env?: Record<string, string>;
  now?: Date;
}

interface Harness {
  deps: PipelineDeps;
  published: Array<{ digest: Digest; parentPageId: string; token: string }>;
  saved: State[];
  pending: Digest[];
  enrichedInputs: Item[][];
  logs: string[];
  warnings: string[];
}

function harness(options: HarnessOptions = {}): Harness {
  const state: State = { sources: {}, buffer: [], ...options.state };
  const published: Harness["published"] = [];
  const saved: State[] = [];
  const pending: Digest[] = [];
  const enrichedInputs: Item[][] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const env = options.env ?? {
    NOTION_TOKEN: "secret",
    NOTION_PARENT_PAGE_ID: "parent-1",
  };

  return {
    published,
    saved,
    pending,
    enrichedInputs,
    logs,
    warnings,
    deps: {
      collect: async () => ({
        items: options.collected ?? [],
        errors: options.collectErrors ?? [],
        scanned: options.scanned ?? 1,
      }),
      enrich: async (items) => {
        enrichedInputs.push(items);
        return options.enriched ?? [];
      },
      publish: async (digest, parentPageId, token) => {
        if (options.publishFails) throw new Error("notion is down");
        published.push({ digest, parentPageId, token });
        return { id: "page-1", url: "https://www.notion.so/page-1" };
      },
      store: {
        load: () => state,
        save: (next) => {
          saved.push(JSON.parse(JSON.stringify(next)) as State);
        },
        savePending: (digest) => {
          pending.push(digest);
          return "state/pending/digest.json";
        },
      },
      now: () => options.now ?? NOW,
      config: pipelineConfig(),
      sources: SOURCES,
      env: { get: (key) => env[key] },
      log: (line) => logs.push(line),
      warn: (line) => warnings.push(line),
    },
  };
}

test("publishes a digest when qualifying items reach the minimum", async () => {
  const h = harness({
    collected: [item({ id: "one" }), item({ id: "two" }), item({ id: "three" })],
    enriched: [
      enriched({ id: "one", title: "one" }),
      enriched({ id: "two", title: "two", url: "https://example.com/b" }),
      enriched({ id: "three", title: "three", url: "https://example.com/c" }),
    ],
  });

  const result = await runPipeline(h.deps);

  assert.equal(result.status, "published");
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0].digest.items.length, 3);
  assert.equal(h.published[0].parentPageId, "parent-1");
  assert.equal(h.published[0].token, "secret");
  assert.equal(result.published?.url, "https://www.notion.so/page-1");
  assert.equal(result.exitCode, 0);
  assert.equal(h.pending.length, 0);
});

test("holds the digest and rolls buffered items forward below the minimum", async () => {
  const h = harness({
    collected: [item({ id: "one" }), item({ id: "two" })],
    enriched: [
      enriched({ id: "one", title: "one" }),
      enriched({ id: "two", title: "two", url: "https://example.com/b" }),
    ],
    state: { lastPublishedAt: "2026-03-25T00:00:00.000Z" },
  });

  const result = await runPipeline(h.deps);

  assert.equal(result.status, "held");
  assert.equal(h.published.length, 0);
  assert.equal(h.saved.length, 1);
  assert.deepEqual(
    h.saved[0].buffer.map((entry) => entry.id),
    ["one", "two"],
  );
  assert.equal(h.saved[0].lastPublishedAt, "2026-03-25T00:00:00.000Z");
  assert.equal(result.exitCode, 0);
});

test("keeps non-qualifying items in the buffer after a successful publish", async () => {
  const h = harness({
    collected: [
      item({ id: "one" }),
      item({ id: "two", url: "https://example.com/b" }),
      item({ id: "three", url: "https://example.com/c" }),
      item({ id: "skip", url: "https://example.com/d", title: "docs tweak" }),
    ],
    enriched: [
      enriched({ id: "one", title: "one" }),
      enriched({ id: "two", title: "two", url: "https://example.com/b" }),
      enriched({ id: "three", title: "three", url: "https://example.com/c" }),
      enriched({
        id: "skip",
        title: "docs tweak",
        url: "https://example.com/d",
        qualifying: false,
      }),
    ],
    state: { lastPublishedAt: "2026-03-01T00:00:00.000Z" },
  });

  const result = await runPipeline(h.deps);

  assert.equal(result.status, "published");
  assert.deepEqual(
    h.saved.at(-1)?.buffer.map((entry) => entry.id),
    ["skip"],
  );
  assert.equal(h.saved.at(-1)?.lastPublishedAt, NOW.toISOString());
});

test("bootstraps the digest window from the configured lookback", async () => {
  const h = harness({
    collected: [item({ id: "one" }), item({ id: "two" }), item({ id: "three" })],
    enriched: [
      enriched({ id: "one", title: "one" }),
      enriched({ id: "two", title: "two", url: "https://example.com/b" }),
      enriched({ id: "three", title: "three", url: "https://example.com/c" }),
    ],
  });

  const result = await runPipeline(h.deps, { dryRun: true });

  assert.equal(result.status, "dry-run");
  assert.equal(result.digest?.windowStart, "2026-03-24T00:00:00.000Z");
  assert.equal(result.digest?.windowEnd, NOW.toISOString());
});

test("starts the digest window at the last published digest", async () => {
  const h = harness({
    collected: [item({ id: "one" }), item({ id: "two" }), item({ id: "three" })],
    enriched: [
      enriched({ id: "one", title: "one" }),
      enriched({ id: "two", title: "two", url: "https://example.com/b" }),
      enriched({ id: "three", title: "three", url: "https://example.com/c" }),
    ],
    state: { lastPublishedAt: "2026-03-28T09:30:00.000Z" },
  });

  const result = await runPipeline(h.deps, { dryRun: true });

  assert.equal(result.digest?.windowStart, "2026-03-28T09:30:00.000Z");
});

test("caps the digest window at the maximum lookback", async () => {
  const h = harness({
    collected: [item({ id: "one" }), item({ id: "two" }), item({ id: "three" })],
    enriched: [
      enriched({ id: "one", title: "one" }),
      enriched({ id: "two", title: "two", url: "https://example.com/b" }),
      enriched({ id: "three", title: "three", url: "https://example.com/c" }),
    ],
    state: { lastPublishedAt: "2026-01-01T00:00:00.000Z" },
  });

  const result = await runPipeline(h.deps, { dryRun: true });

  assert.equal(result.digest?.windowStart, "2026-02-24T00:00:00.000Z");
});

test("leaves qualifying items published before the window out of the digest", async () => {
  const h = harness({
    collected: [
      item({ id: "old", title: "old", publishedAt: "2026-03-01T00:00:00.000Z" }),
      item({ id: "one", title: "one" }),
      item({ id: "two", title: "two", url: "https://example.com/b" }),
    ],
    enriched: [
      enriched({ id: "old", title: "old", publishedAt: "2026-03-01T00:00:00.000Z" }),
      enriched({ id: "one", title: "one" }),
      enriched({ id: "two", title: "two", url: "https://example.com/b" }),
    ],
  });

  const result = await runPipeline(h.deps, { dryRun: true });

  assert.deepEqual(
    result.digest?.items.map((entry) => entry.id),
    ["one", "two"],
  );
});

test("forces a digest once the publish interval has elapsed", async () => {
  const h = harness({
    collected: [item({ id: "one" })],
    enriched: [enriched({ id: "one", title: "one" })],
    state: { lastPublishedAt: "2026-02-01T00:00:00.000Z" },
  });

  const result = await runPipeline(h.deps);

  assert.equal(result.status, "published");
  assert.equal(h.published.length, 1);
  assert.deepEqual(
    h.published[0].digest.items.map((entry) => entry.id),
    ["one"],
  );
});

test("a dry run writes no state and publishes nothing", async () => {
  const h = harness({
    collected: [item({ id: "one" }), item({ id: "two" }), item({ id: "three" })],
    enriched: [
      enriched({ id: "one", title: "one" }),
      enriched({ id: "two", title: "two", url: "https://example.com/b" }),
      enriched({ id: "three", title: "three", url: "https://example.com/c" }),
    ],
  });

  const result = await runPipeline(h.deps, { dryRun: true });

  assert.equal(result.status, "dry-run");
  assert.equal(h.published.length, 0);
  assert.equal(h.saved.length, 0);
  assert.equal(h.pending.length, 0);
});

test("buffers the digest and exits non-zero when publishing fails", async () => {
  const h = harness({
    collected: [item({ id: "one" }), item({ id: "two" }), item({ id: "three" })],
    enriched: [
      enriched({ id: "one", title: "one" }),
      enriched({ id: "two", title: "two", url: "https://example.com/b" }),
      enriched({ id: "three", title: "three", url: "https://example.com/c" }),
    ],
    publishFails: true,
  });

  const result = await runPipeline(h.deps);

  assert.equal(result.status, "publish-failed");
  assert.equal(result.exitCode, 1);
  assert.equal(result.message, "Notion publish failed (buffered at state/pending/digest.json): notion is down");
  assert.deepEqual(
    h.pending.map((digest) => digest.items.map((entry) => entry.id)),
    [["one", "two", "three"]],
  );
  assert.deepEqual(
    h.saved.at(-1)?.buffer.map((entry) => entry.id),
    ["one", "two", "three"],
  );
  assert.equal(h.saved.at(-1)?.lastPublishedAt, undefined);
});

test("exits non-zero when some sources fail to collect", async () => {
  const h = harness({
    collected: [item({ id: "one" }), item({ id: "two" }), item({ id: "three" })],
    enriched: [
      enriched({ id: "one", title: "one" }),
      enriched({ id: "two", title: "two", url: "https://example.com/b" }),
      enriched({ id: "three", title: "three", url: "https://example.com/c" }),
    ],
    collectErrors: ["example: GitHub example/example responded 500"],
    scanned: 1,
  });

  const result = await runPipeline(h.deps);

  assert.equal(result.status, "published");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.errors, ["example: GitHub example/example responded 500"]);
  assert.deepEqual(h.warnings, ["source failed -> example: GitHub example/example responded 500"]);
  assert.equal(h.published[0].digest.sourcesScanned, 1);
});

test("skips when nothing is buffered and persists state", async () => {
  const h = harness();

  const result = await runPipeline(h.deps);

  assert.equal(result.status, "skipped-empty-buffer");
  assert.equal(h.saved.length, 1);
  assert.equal(h.enrichedInputs.length, 0);
  assert.equal(result.exitCode, 0);
});

test("fails loudly when the Notion environment is incomplete", async () => {
  const h = harness({
    collected: [item({ id: "one" }), item({ id: "two" }), item({ id: "three" })],
    enriched: [
      enriched({ id: "one", title: "one" }),
      enriched({ id: "two", title: "two", url: "https://example.com/b" }),
      enriched({ id: "three", title: "three", url: "https://example.com/c" }),
    ],
    env: { NOTION_TOKEN: "secret" },
  });

  await assert.rejects(() => runPipeline(h.deps), {
    message: "NOTION_TOKEN and NOTION_PARENT_PAGE_ID must be set",
  });
  assert.equal(h.published.length, 0);
});
