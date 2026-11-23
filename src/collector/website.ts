import crypto from "node:crypto";
import type { FetchLike, Item, SourceConfig } from "../types";

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decode(match[1]).trim() : null;
}

function stripHtml(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export interface WebsiteResult {
  items: Item[];
  seenId: string;
}

const TEXT_LIMIT = 4000;

/** Prefer the response's Last-Modified header as the publish date when it parses. */
function publishedAt(res: Response, now: Date): string {
  const header = res.headers?.get("last-modified");
  if (header) {
    const parsed = new Date(header);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return now.toISOString();
}

export async function collectWebsite(
  source: SourceConfig,
  previousSeenId: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<WebsiteResult> {
  const res = await fetchImpl(source.url, {
    headers: { "User-Agent": "cloud-native-security-news-digest" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`${source.name} responded ${res.status}`);
  }

  const html = await res.text();
  // Hash the whole page so a change past the truncation point is still detected,
  // but keep only the truncated text on the item.
  const fullText = stripHtml(html);
  const seenId = crypto.createHash("sha256").update(fullText).digest("hex");

  if (previousSeenId === seenId) {
    return { items: [], seenId };
  }

  return {
    seenId,
    items: [
      {
        id: `${source.key}:${seenId}`,
        sourceKey: source.key,
        sourceName: source.name,
        category: source.category,
        priority: source.priority,
        type: source.type,
        title: extractTitle(html) || source.name,
        url: source.url,
        publishedAt: publishedAt(res, new Date()),
        text: fullText.slice(0, TEXT_LIMIT),
      },
    ],
  };
}
