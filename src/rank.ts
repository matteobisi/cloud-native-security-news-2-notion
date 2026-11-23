import type { EnrichedItem, Priority } from "./types";

const PRIORITY_ORDER: Record<Priority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
};

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function dedupe(items: EnrichedItem[]): EnrichedItem[] {
  const urls = new Set<string>();
  const titles = new Set<string>();
  const kept: EnrichedItem[] = [];

  for (const item of items) {
    const url = canonicalUrl(item.url);
    const title = titleKey(item.title);
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
