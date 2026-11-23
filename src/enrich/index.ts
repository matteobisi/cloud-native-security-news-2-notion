import type { EnrichedItem, Item, PipelineConfig } from "../types";
import { screenItems } from "./keywords";
import { callJsonModel } from "./model";

interface Judgement {
  id?: string;
  qualifying?: boolean;
  severity?: number;
  summary?: string;
  whyItMatters?: string;
}

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

function fallback(item: Item, signals: string[]): EnrichedItem {
  const hits = signals.filter((signal) =>
    `${item.title} ${item.text}`.toLowerCase().includes(signal.toLowerCase()),
  );
  return {
    ...item,
    qualifying: hits.length > 0,
    severity: item.priority === "CRITICAL" ? 4 : 3,
    summary: item.title,
    whyItMatters: hits.length > 0 ? `Matched security signals: ${hits.join(", ")}` : "",
  };
}

export async function enrich(
  items: Item[],
  pipeline: PipelineConfig,
): Promise<EnrichedItem[]> {
  const { candidates } = screenItems(items, pipeline.securitySignals);
  if (candidates.length === 0) return [];

  let judgements: Judgement[] = [];
  try {
    const raw = await callJsonModel(pipeline.model, buildPrompt(candidates));
    if (Array.isArray(raw)) judgements = raw as Judgement[];
  } catch (error) {
    console.warn(`enrichment fell back to rules: ${(error as Error).message}`);
  }

  const byId = new Map(judgements.map((judgement) => [judgement.id, judgement]));

  return candidates.map((item) => {
    const judgement = byId.get(item.id);
    if (!judgement) return fallback(item, pipeline.securitySignals);
    return {
      ...item,
      qualifying: Boolean(judgement.qualifying),
      severity: clamp(Number(judgement.severity) || 3, 1, 5),
      summary: judgement.summary || item.title,
      whyItMatters: judgement.whyItMatters || "",
    };
  });
}
