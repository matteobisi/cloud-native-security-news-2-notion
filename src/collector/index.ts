import type { Item, PipelineConfig, SourceConfig } from "../types";
import type { SourceState, State } from "../state/store";
import { collectGitHub } from "./github";
import { collectJsonFeed } from "./jsonfeed";
import type { SourceResult } from "./result";
import { collectRss } from "./rss";
import { collectWebsite } from "./website";

export interface CollectResult {
  items: Item[];
  errors: string[];
  scanned: number;
}

function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function latestItem(items: Item[]): Item {
  return items.reduce((newest, item) =>
    item.publishedAt > newest.publishedAt ? item : newest,
  );
}

export async function collectAll(
  sources: SourceConfig[],
  pipeline: PipelineConfig,
  state: State,
  now: Date,
): Promise<CollectResult> {
  const items: Item[] = [];
  const errors: string[] = [];
  let scanned = 0;

  for (const source of sources) {
    const previous = state.sources[source.key];
    const since = previous?.lastSeenAt
      ? new Date(previous.lastSeenAt)
      : subtractDays(now, pipeline.cadence.bootstrapWindowDays);

    try {
      if (source.type === "website") {
        const result = await collectWebsite(source, previous?.lastSeenId);
        items.push(...result.items);
        state.sources[source.key] = {
          lastSeenId: result.seenId,
          lastSeenAt: now.toISOString(),
        };
      } else {
        const etag = previous?.etag;
        let result: SourceResult;
        if (source.type === "github_release") {
          result = await collectGitHub(
            source,
            since,
            pipeline.limits.maxItemsPerSource,
            fetch,
            etag,
          );
        } else if (source.type === "rss") {
          result = await collectRss(
            source,
            since,
            pipeline.limits.maxItemsPerSource,
            fetch,
            etag,
          );
        } else {
          result = await collectJsonFeed(
            source,
            since,
            pipeline.limits.maxItemsPerSource,
            fetch,
            etag,
          );
        }

        items.push(...result.items);
        const next: SourceState = { ...previous };
        if (result.etag !== undefined) next.etag = result.etag;
        if (result.items.length > 0) {
          const latest = latestItem(result.items);
          next.lastSeenId = latest.id;
          next.lastSeenAt = latest.publishedAt;
        }
        if (result.items.length > 0 || result.etag !== undefined) {
          state.sources[source.key] = next;
        }
      }
      scanned += 1;
    } catch (error) {
      errors.push(`${source.name}: ${(error as Error).message}`);
    }
  }

  return { items, errors, scanned };
}

export function mergeIntoBuffer(state: State, items: Item[]): void {
  const byId = new Map(state.buffer.map((item) => [item.id, item]));
  for (const item of items) byId.set(item.id, item);
  state.buffer = [...byId.values()];
}
