import { mergeIntoBuffer, type CollectResult } from "./collector";
import { dedupe, selectForDigest } from "./rank";
import type { State } from "./state/store";
import type {
  Digest,
  EnrichedItem,
  Item,
  PipelineConfig,
  PipelineStatus,
  SourceConfig,
} from "./types";

/** Fetch a source's new content, updating last-seen markers in state. */
export type Collect = (
  sources: SourceConfig[],
  pipeline: PipelineConfig,
  state: State,
  now: Date,
) => Promise<CollectResult>;

/** Judge and describe buffered items. */
export type Enrich = (
  items: Item[],
  pipeline: PipelineConfig,
  options?: { warn?(line: string): void },
) => Promise<EnrichedItem[]>;

/** Publish one digest and return its page id and url. */
export type Publish = (
  digest: Digest,
  parentPageId: string,
  token: string,
) => Promise<{ id: string; url: string }>;

/** Persistent state operations, injected so tests can keep everything in memory. */
export interface StateStore {
  load(): State;
  save(state: State): void;
  savePending(digest: Digest): string;
  listPending?(): Array<{ path: string; digest: Digest }>;
  removePending?(path: string): void;
}

/** Environment/token access, injected so tests never read the real process env. */
export interface Env {
  get(key: string): string | undefined;
}

export interface PipelineDeps {
  collect: Collect;
  enrich: Enrich;
  publish: Publish;
  store: StateStore;
  now(): Date;
  config: PipelineConfig;
  sources: SourceConfig[];
  env: Env;
  log?(line: string): void;
  warn?(line: string): void;
}

export interface PipelineOptions {
  dryRun?: boolean;
}

export interface PipelineResult {
  status: PipelineStatus;
  errors: string[];
  exitCode: number;
  digest?: Digest;
  published?: { id: string; url: string };
  pendingPath?: string;
  message?: string;
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
}

function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

export function windowStart(state: State, pipeline: PipelineConfig, now: Date): Date {
  const cap = subtractDays(now, pipeline.cadence.maxWindowDays);
  if (!state.lastPublishedAt) {
    return subtractDays(now, pipeline.cadence.bootstrapWindowDays);
  }
  const last = new Date(state.lastPublishedAt);
  return last > cap ? last : cap;
}

function dueToPublish(state: State, pipeline: PipelineConfig, now: Date): boolean {
  if (!state.lastPublishedAt) return true;
  return daysBetween(new Date(state.lastPublishedAt), now) >= pipeline.cadence.forcePublishAfterDays;
}

function buildDigest(
  items: EnrichedItem[],
  omitted: number,
  pipeline: PipelineConfig,
  start: Date,
  now: Date,
  scanned: number,
): Digest {
  return {
    title: `Cloud Native Security Digest — ${now.toISOString().slice(0, 10)}`,
    date: now.toISOString(),
    windowStart: start.toISOString(),
    windowEnd: now.toISOString(),
    items,
    omitted,
    sourcesScanned: scanned,
    model: pipeline.model.name,
  };
}

/**
 * The single orchestration seam: cadence, digest window, buffering, ranking,
 * publishing and state transitions, with every collaborator injected.
 */
export async function runPipeline(
  deps: PipelineDeps,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const { collect, enrich, publish, store, config, sources, env } = deps;
  const log = deps.log ?? (() => {});
  const warn = deps.warn ?? (() => {});
  const dryRun = options.dryRun ?? false;

  const state = store.load();
  const now = deps.now();
  const token = env.get("NOTION_TOKEN");
  const parentPageId = env.get("NOTION_PARENT_PAGE_ID");

  if (sources.some((source) => source.type === "github_release") && !env.get("GITHUB_TOKEN")) {
    throw new Error("GITHUB_TOKEN must be set when a github_release Source is enabled");
  }

  if (!dryRun && token && parentPageId && store.listPending && store.removePending) {
    for (const pending of store.listPending()) {
      try {
        const published = await publish(pending.digest, parentPageId, token);
        store.removePending(pending.path);
        log(`retried pending digest -> ${published.url}`);
        if (!state.lastPublishedAt || pending.digest.windowEnd > state.lastPublishedAt) {
          state.lastPublishedAt = pending.digest.windowEnd;
        }
      } catch (error) {
        warn(`pending digest still failing: ${(error as Error).message}`);
      }
    }
  }

  log(`scanning ${sources.length} sources`);
  const collected = await collect(sources, config, state, now);
  const errors = [...collected.errors];
  for (const error of errors) warn(`source failed -> ${error}`);
  log(`collected ${collected.items.length} new items`);

  mergeIntoBuffer(state, collected.items);

  const bufferCap = subtractDays(now, config.cadence.maxWindowDays);
  state.buffer = state.buffer.filter((item) => new Date(item.publishedAt) >= bufferCap);

  if (state.buffer.length === 0) {
    log("nothing pending; skipping");
    if (!dryRun) store.save(state);
    return { status: "skipped-empty-buffer", errors, exitCode: errors.length > 0 ? 1 : 0 };
  }

  log("enriching items");
  const enriched = await enrich(state.buffer, config, { warn });
  const start = windowStart(state, config, now);
  const qualifying = dedupe(
    enriched.filter((item) => item.qualifying && new Date(item.publishedAt) >= start),
  );

  const selected = selectForDigest(qualifying, config.limits.maxItemsPerDigest);
  const digest = buildDigest(selected.items, selected.omitted, config, start, now, collected.scanned);

  // A dry run always previews the digest for the window, even below the minimum.
  if (dryRun) {
    return { status: "dry-run", errors, exitCode: errors.length > 0 ? 1 : 0, digest };
  }

  const forced = dueToPublish(state, config, now);
  const shouldPublish = forced || qualifying.length >= config.cadence.minQualifyingItems;
  if (!shouldPublish) {
    log(
      `${qualifying.length} qualifying item(s) < ${config.cadence.minQualifyingItems}; holding until next run`,
    );
    store.save(state);
    return { status: "held", errors, exitCode: errors.length > 0 ? 1 : 0 };
  }

  // A forced digest publishes even with no qualifying items, so the archive is never silent.
  if (!token || !parentPageId) {
    throw new Error("NOTION_TOKEN and NOTION_PARENT_PAGE_ID must be set");
  }

  try {
    const published = await publish(digest, parentPageId, token);
    log(`published ${digest.items.length} items -> ${published.url}`);
    state.lastPublishedAt = now.toISOString();
    const publishedIds = new Set(qualifying.map((item) => item.id));
    state.buffer = state.buffer.filter((item) => !publishedIds.has(item.id));
    store.save(state);
    return {
      status: "published",
      errors,
      exitCode: errors.length > 0 ? 1 : 0,
      digest,
      published,
    };
  } catch (error) {
    const pendingPath = store.savePending(digest);
    store.save(state);
    return {
      status: "publish-failed",
      errors,
      exitCode: 1,
      digest,
      pendingPath,
      message: `Notion publish failed (buffered at ${pendingPath}): ${(error as Error).message}`,
    };
  }
}
