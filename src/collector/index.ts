import type { Item, PipelineConfig, SourceConfig } from "../types";
import type { State } from "../state/store";
import { collectGitHub } from "./github";
import { collectWebsite } from "./website";

export interface CollectResult {
  items: Item[];
  errors: string[];
  scanned: number;
}

function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
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
      if (source.type === "github_release" || source.type === "github_repo") {
        const found = await collectGitHub(source, since, pipeline.limits.maxItemsPerSource);
        items.push(...found);
        const newest = found
          .map((item) => item.publishedAt)
          .sort()
          .at(-1);
        state.sources[source.key] = {
          lastSeenId: found[0]?.id ?? previous?.lastSeenId,
          lastSeenAt: newest ?? now.toISOString(),
        };
      } else if (source.type === "website") {
        const result = await collectWebsite(source, previous?.lastSeenId);
        items.push(...result.items);
        state.sources[source.key] = {
          lastSeenId: result.seenId,
          lastSeenAt: now.toISOString(),
        };
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
