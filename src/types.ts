export type Priority = "CRITICAL" | "HIGH" | "MEDIUM";

/**
 * The subset of `fetch` the source adapters use. Adapters default to the global
 * fetch and accept an injected implementation, so they can be driven offline.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type SourceType = "github_release" | "rss" | "json_feed" | "website";

export interface SourceConfig {
  key: string;
  name: string;
  url: string;
  type: SourceType;
  category: string;
  priority: Priority;
  includePrereleases?: boolean;
  notes?: string;
}

export interface PipelineConfig {
  cadence: {
    minQualifyingItems: number;
    forcePublishAfterDays: number;
    maxWindowDays: number;
    bootstrapWindowDays: number;
  };
  limits: {
    maxItemsPerDigest: number;
    maxItemsPerSource: number;
  };
  model: {
    baseUrl: string;
    name: string;
    temperature: number;
    maxTokens: number;
  };
  securitySignals: string[];
  paths: {
    sourcesDir: string;
    stateDir: string;
  };
}

export interface Item {
  id: string;
  sourceKey: string;
  sourceName: string;
  category: string;
  priority: Priority;
  type: SourceType;
  title: string;
  url: string;
  publishedAt: string;
  text: string;
}

export interface EnrichedItem extends Item {
  qualifying: boolean;
  severity: number;
  summary: string;
  whyItMatters: string;
}

export interface Digest {
  title: string;
  date: string;
  windowStart: string;
  windowEnd: string;
  items: EnrichedItem[];
  omitted: number;
  sourcesScanned: number;
  model: string;
}
