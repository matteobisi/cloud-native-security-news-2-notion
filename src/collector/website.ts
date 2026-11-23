import crypto from "node:crypto";
import type { Item, SourceConfig } from "../types";

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

export async function collectWebsite(
  source: SourceConfig,
  previousSeenId: string | undefined,
): Promise<WebsiteResult> {
  const res = await fetch(source.url, {
    headers: { "User-Agent": "cloud-native-security-news-digest" },
  });
  if (!res.ok) {
    throw new Error(`${source.name} responded ${res.status}`);
  }

  const html = await res.text();
  const text = stripHtml(html).slice(0, 4000);
  const seenId = crypto.createHash("sha256").update(text).digest("hex");

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
        publishedAt: new Date().toISOString(),
        text,
      },
    ],
  };
}
