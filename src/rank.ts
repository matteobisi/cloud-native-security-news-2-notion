import type { EnrichedItem, Priority } from "./types";
import { canonicalUrl } from "./url";

const PRIORITY_ORDER: Record<Priority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
};

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Canonical urls dedupe globally, but normalized titles only dedupe within one
 * Source: unrelated projects routinely ship the same tag ("v1.2.0").
 */
function titleKeyForSource(item: EnrichedItem): string {
  return `${item.sourceKey}\u0000${titleKey(item.title)}`;
}

export function dedupe(items: EnrichedItem[]): EnrichedItem[] {
  const urls = new Set<string>();
  const titles = new Set<string>();
  const kept: EnrichedItem[] = [];

  for (const item of items) {
    const url = canonicalUrl(item.url);
    const title = titleKeyForSource(item);
    if (urls.has(url) || titles.has(title)) continue;
    urls.add(url);
    titles.add(title);
    kept.push(item);
  }

  return kept;
}

export function rank(items: EnrichedItem[]): EnrichedItem[] {
  return [...items].sort((a, b) => {
    const priority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priority !== 0) return priority;
    if (a.severity !== b.severity) return b.severity - a.severity;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
}

export function selectForDigest(
  items: EnrichedItem[],
  max: number,
): { items: EnrichedItem[]; omitted: number } {
  const ranked = rank(dedupe(items));
  return {
    items: ranked.slice(0, max),
    omitted: Math.max(0, ranked.length - max),
  };
}
