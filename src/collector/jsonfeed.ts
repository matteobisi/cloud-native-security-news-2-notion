import { stripHtml, TEXT_LIMIT } from "./html";
import type { SourceResult } from "./result";
import type { FetchLike, Item, SourceConfig } from "../types";

interface JsonFeedItem {
  id?: string | number;
  url?: string;
  external_url?: string;
  title?: string;
  content_text?: string;
  content_html?: string;
  summary?: string;
  date_published?: string;
  date_modified?: string;
}

interface JsonFeed {
  version?: string;
  items?: JsonFeedItem[];
}

export async function collectJsonFeed(
  source: SourceConfig,
  since: Date,
  perSource: number,
  fetchImpl: FetchLike = fetch,
  etag?: string,
): Promise<SourceResult> {
  const headers: Record<string, string> = {
    Accept: "application/feed+json, application/json",
    "User-Agent": "cloud-native-security-news-digest",
  };
  if (etag) headers["If-None-Match"] = etag;

  const res = await fetchImpl(source.url, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 304) return { items: [], etag };
  if (!res.ok) {
    throw new Error(`${source.name} responded ${res.status}`);
  }

  const doc = (await res.json()) as JsonFeed;
  if (!Array.isArray(doc?.items)) {
    throw new Error(`${source.name} is not a JSON Feed`);
  }

  const items: Item[] = [];
  for (const entry of doc.items) {
    const raw = entry.date_published ?? entry.date_modified;
    if (!raw) continue;
    const published = new Date(raw);
    if (Number.isNaN(published.getTime())) continue;
    if (published < since) continue;

    const url = entry.url ?? entry.external_url ?? source.url;
    const text = entry.content_text
      ? entry.content_text
      : stripHtml(entry.content_html ?? entry.summary ?? "");

    items.push({
      id: `${source.key}:${entry.id ?? url}`,
      sourceKey: source.key,
      sourceName: source.name,
      category: source.category,
      priority: source.priority,
      type: source.type,
      title: entry.title || source.name,
      url,
      publishedAt: published.toISOString(),
      text: text.slice(0, TEXT_LIMIT),
    });
    if (items.length >= perSource) break;
  }

  return { items, etag: res.headers?.get("etag") ?? etag };
}
