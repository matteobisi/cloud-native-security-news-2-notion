import type { EnrichedItem, FetchLike, Item, PipelineConfig, Priority } from "../types";
import { screenItems } from "./keywords";
import { callJsonModel } from "./model";

interface Judgement {
  id?: string;
  qualifying?: boolean;
  severity?: number;
  summary?: string;
  whyItMatters?: string;
}

/** Injected seams so enrichment can be exercised offline. */
export interface EnrichOptions {
  warn?(line: string): void;
  fetchImpl?: FetchLike;
}

const FALLBACK_SEVERITY: Record<Priority, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildPrompt(candidates: Item[]): string {
  const payload = candidates.map((item) => ({
    id: item.id,
    source: item.sourceName,
    category: item.category,
    priority: item.priority,
    title: item.title,
    publishedAt: item.publishedAt,
    text: item.text.slice(0, 1500),
  }));

  return [
    "Classify each item below as security-relevant news.",
    "Return a JSON array with one object per item, using this exact shape:",
    '[{"id":"<id>","qualifying":true,"severity":1-5,"summary":"<=2 sentences","whyItMatters":"<=1 sentence"}]',
    "Set qualifying=true only when the item contains a genuine security signal",
    "(patch, vulnerability, advisory, breaking change with security impact, auth/secrets change).",
    "Severity: 5 = critical/exploitable, 4 = high, 3 = moderate, 2 = low, 1 = informational.",
    "Summarize only what the text says. Do not invent CVE numbers or links.",
    "Items:",
    JSON.stringify(payload),
  ].join("\n");
}

/** Rule-based judgement, using the security signals the screen already matched. */
function fallback(item: Item, hits: string[]): EnrichedItem {
  return {
    ...item,
    qualifying: hits.length > 0,
    severity: FALLBACK_SEVERITY[item.priority] ?? 3,
    summary: item.title,
    whyItMatters: hits.length > 0 ? `Matched security signals: ${hits.join(", ")}` : "",
  };
}

export async function enrich(
  items: Item[],
  pipeline: PipelineConfig,
  options: EnrichOptions = {},
): Promise<EnrichedItem[]> {
  const warn = options.warn ?? ((line: string) => console.warn(line));
  const fetchImpl = options.fetchImpl;
  const { candidates, matches } = screenItems(items, pipeline.securitySignals);
  if (candidates.length === 0) return [];

  let judgements: Judgement[] = [];
  const batchSize = 8;
  for (let index = 0; index < candidates.length; index += batchSize) {
    try {
      const raw = await callJsonModel(
        pipeline.model,
        buildPrompt(candidates.slice(index, index + batchSize)),
        fetchImpl,
      );
      if (Array.isArray(raw)) judgements.push(...(raw as Judgement[]));
    } catch (error) {
      warn(`enrichment batch fell back to rules: ${(error as Error).message}`);
    }
  }

  const byId = new Map(judgements.map((judgement) => [judgement.id, judgement]));

  return candidates.map((item) => {
    const judgement = byId.get(item.id);
    if (!judgement) return fallback(item, matches.get(item.id) ?? []);
    return {
      ...item,
      qualifying: Boolean(judgement.qualifying),
      severity: clamp(Number(judgement.severity) || 3, 1, 5),
      summary: judgement.summary || item.title,
      whyItMatters: judgement.whyItMatters || "",
    };
  });
}
