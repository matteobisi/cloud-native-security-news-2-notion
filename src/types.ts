export type Priority = "CRITICAL" | "HIGH" | "MEDIUM";

export type SourceType = "github_release" | "github_repo" | "website" | "mailing_list";

export interface SourceConfig {
  key: string;
  name: string;
  url: string;
  type: SourceType;
  category: string;
  priority: Priority;
  notes?: string;
}

export interface PipelineConfig {
  categories: string[];
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
