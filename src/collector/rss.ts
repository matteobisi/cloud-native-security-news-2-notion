import { XMLParser } from "fast-xml-parser";
import { stripHtml, TEXT_LIMIT } from "./html";
import type { SourceResult } from "./result";
import type { FetchLike, Item, SourceConfig } from "../types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

type XmlNode = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    const node = value as XmlNode;
    if (typeof node["#text"] === "string" || typeof node["#text"] === "number") {
      return String(node["#text"]);
    }
    if (typeof node["@_href"] === "string") return node["@_href"];
  }
  return "";
}

function atomLink(link: unknown): string {
  const links = asArray(link);
  const alternate = links.find(
    (candidate) => (candidate as XmlNode)?.["@_rel"] === "alternate",
  );
  return textOf(alternate ?? links[0]);
}

function entryDate(entry: XmlNode): string | null {
  const raw = textOf(entry.pubDate ?? entry.published ?? entry.updated ?? entry["dc:date"]);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function entryText(entry: XmlNode): string {
  const raw = textOf(
    entry.description ??
      entry.summary ??
      entry["content:encoded"] ??
      entry.content ??
      entry["media:description"],
  );
  return stripHtml(raw).slice(0, TEXT_LIMIT);
}

function toItem(source: SourceConfig, entry: XmlNode, link: string, date: string): Item {
  const id = textOf(entry.guid ?? entry.id) || link || `${date}:${textOf(entry.title)}`;
  return {
    id: `${source.key}:${id}`,
    sourceKey: source.key,
    sourceName: source.name,
    category: source.category,
    priority: source.priority,
    type: source.type,
    title: textOf(entry.title) || source.name,
    url: link || source.url,
    publishedAt: date,
    text: entryText(entry),
  };
}

export async function collectRss(
  source: SourceConfig,
  since: Date,
  perSource: number,
  fetchImpl: FetchLike = fetch,
  etag?: string,
): Promise<SourceResult> {
  const headers: Record<string, string> = {
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
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

  const xml = await res.text();
  const doc = parser.parse(xml) as XmlNode;
  const rss = asArray(doc.rss as XmlNode | XmlNode[])[0];
  const channel = rss?.channel as XmlNode | undefined;
  const atom = doc.feed as XmlNode | undefined;

  const entries: Array<{ entry: XmlNode; link: string }> = [];

  if (channel) {
    for (const entry of asArray(channel.item as XmlNode | XmlNode[])) {
      entries.push({ entry, link: textOf(entry.link) || textOf(entry.guid) });
    }
  } else if (atom) {
    for (const entry of asArray(atom.entry as XmlNode | XmlNode[])) {
      entries.push({ entry, link: atomLink(entry.link) });
    }
  } else {
    throw new Error(`${source.name} is not an RSS or Atom feed`);
  }

  const items: Item[] = [];
  for (const { entry, link } of entries) {
    const date = entryDate(entry);
    if (!date) continue;
    if (new Date(date) < since) continue;
    items.push(toItem(source, entry, link, date));
    if (items.length >= perSource) break;
  }

  return { items, etag: res.headers?.get("etag") ?? etag };
}
