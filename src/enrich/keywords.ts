import type { Item } from "../types";

export interface ScreenResult {
  candidates: Item[];
  matches: Map<string, string[]>;
}

export function screenItems(items: Item[], signals: string[]): ScreenResult {
  const candidates: Item[] = [];
  const matches = new Map<string, string[]>();

  for (const item of items) {
    const haystack = `${item.title} ${item.text}`.toLowerCase();
    const hit = signals.filter((signal) => haystack.includes(signal.toLowerCase()));
    if (hit.length === 0) continue;
    candidates.push(item);
    matches.set(item.id, hit);
  }

  return { candidates, matches };
}
