import type { Digest, EnrichedItem } from "../types";

const NOTION_VERSION = "2026-03-11";
const API = "https://api.notion.com/v1";
const MAX_CHILDREN = 100;

type Block = Record<string, unknown>;

function truncate(text: string, max = 1900): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function richText(content: string): Array<Record<string, unknown>> {
  return [{ type: "text", text: { content: truncate(content) } }];
}

function paragraph(content: string): Block {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText(content) } };
}

function heading(level: 1 | 2 | 3, content: string): Block {
  const key = `heading_${level}`;
  return { object: "block", type: key, [key]: { rich_text: richText(content) } };
}

function callout(content: string, emoji: string, color: string): Block {
  return {
    object: "block",
    type: "callout",
    callout: {
      rich_text: richText(content),
      icon: { type: "emoji", emoji },
      color,
    },
  };
}

function bullet(content: string): Block {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: richText(content) },
  };
}

function severityEmoji(severity: number): string {
  if (severity >= 5) return "🚨";
  if (severity >= 4) return "🔴";
  if (severity >= 3) return "🟠";
  if (severity >= 2) return "🟡";
  return "⚪";
}

function itemToggle(item: EnrichedItem): Block {
  const children: Block[] = [paragraph(item.summary)];
  if (item.whyItMatters) children.push(paragraph(`Why it matters: ${item.whyItMatters}`));
  children.push({ object: "block", type: "bookmark", bookmark: { url: item.url } });

  return {
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: richText(
        `${severityEmoji(item.severity)} ${item.title} — ${item.sourceName}`,
      ),
      children,
    },
  };
}

function needsRedCallout(item: EnrichedItem): boolean {
  return item.priority === "CRITICAL" || item.severity >= 5;
}

export function buildBlocks(digest: Digest): Block[] {
  const blocks: Block[] = [heading(1, digest.title)];

  const top = digest.items.slice(0, 3);
  const summary =
    `${digest.items.length} qualifying updates across ${countCategories(digest)} categories.` +
    (top.length > 0 ? ` Top: ${top.map((item) => item.title).join("; ")}.` : "");
  blocks.push(callout(truncate(summary, 1900), "💡", "blue_background"));

  if (top.length > 0) {
    blocks.push(heading(2, "Top stories"));
    for (const item of top) {
      blocks.push(bullet(`${severityEmoji(item.severity)} ${item.title} — ${item.sourceName}`));
    }
  }

  for (const [category, items] of groupByCategory(digest.items)) {
    blocks.push(heading(2, category));
    for (const item of items.filter(needsRedCallout)) {
      blocks.push(callout(`${item.title}: ${item.summary}`, "🚨", "red_background"));
    }
    for (const item of items) blocks.push(itemToggle(item));
  }

  if (digest.omitted > 0) {
    blocks.push(paragraph(`${digest.omitted} additional qualifying items were omitted.`));
  }

  blocks.push({ object: "block", type: "divider", divider: {} });
  blocks.push(
    paragraph(
      `Window: ${digest.windowStart.slice(0, 10)} → ${digest.windowEnd.slice(0, 10)} · ` +
        `Sources scanned: ${digest.sourcesScanned} · Model: ${digest.model}`,
    ),
  );

  return blocks;
}

function countCategories(digest: Digest): number {
  return new Set(digest.items.map((item) => item.category)).size;
}

export function groupByCategory(items: EnrichedItem[]): Array<[string, EnrichedItem[]]> {
  const groups = new Map<string, EnrichedItem[]>();
  for (const item of items) {
    const existing = groups.get(item.category) ?? [];
    existing.push(item);
    groups.set(item.category, existing);
  }
  return [...groups.entries()];
}

export interface PublishResult {
  id: string;
  url: string;
}

async function notionRequest(
  path: string,
  token: string,
  init: RequestInit,
): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(`${API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (res.status === 429 || res.status === 529) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      throw new Error(`Notion ${init.method ?? "GET"} ${path} responded ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as Record<string, any>;
  }

  throw new Error(`Notion ${path} failed after retries`);
}

export async function publishDigest(
  digest: Digest,
  parentPageId: string,
  token: string,
): Promise<PublishResult> {
  const blocks = buildBlocks(digest);
  const firstChunk = blocks.slice(0, MAX_CHILDREN);
  const rest = blocks.slice(MAX_CHILDREN);

  const page = await notionRequest("/pages", token, {
    method: "POST",
    body: JSON.stringify({
      parent: { page_id: parentPageId },
      properties: {
        title: { title: [{ type: "text", text: { content: truncate(digest.title, 200) } }] },
      },
      children: firstChunk,
    }),
  });

  const pageId = String(page.id);
  for (let index = 0; index < rest.length; index += MAX_CHILDREN) {
    await notionRequest(`/blocks/${pageId}/children`, token, {
      method: "PATCH",
      body: JSON.stringify({ children: rest.slice(index, index + MAX_CHILDREN) }),
    });
  }

  return { id: pageId, url: String(page.url ?? "") };
}
