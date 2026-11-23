import path from "node:path";
import { loadConfig } from "./config";
import { collectAll, mergeIntoBuffer } from "./collector";
import { enrich } from "./enrich";
import { selectForDigest } from "./rank";
import { publishDigest } from "./render/notion";
import { loadState, resetState, savePending, saveState, type State } from "./state/store";
import type { Digest, EnrichedItem, PipelineConfig } from "./types";

interface RunOptions {
  dryRun: boolean;
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
}

function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function windowStart(state: State, pipeline: PipelineConfig, now: Date): Date {
  const cap = subtractDays(now, pipeline.cadence.maxWindowDays);
  if (!state.lastPublishedAt) {
    return subtractDays(now, pipeline.cadence.bootstrapWindowDays);
  }
  const last = new Date(state.lastPublishedAt);
  return last > cap ? last : cap;
}

function dueToPublish(state: State, pipeline: PipelineConfig, now: Date): boolean {
  if (!state.lastPublishedAt) return true;
  return daysBetween(new Date(state.lastPublishedAt), now) >= pipeline.cadence.forcePublishAfterDays;
}

function buildDigest(
  items: EnrichedItem[],
  omitted: number,
  pipeline: PipelineConfig,
  start: Date,
  now: Date,
  scanned: number,
): Digest {
  return {
    title: `Cloud Native Security Digest — ${now.toISOString().slice(0, 10)}`,
    date: now.toISOString(),
    windowStart: start.toISOString(),
    windowEnd: now.toISOString(),
    items,
    omitted,
    sourcesScanned: scanned,
    model: pipeline.model.name,
  };
}

function printDryRun(digest: Digest): void {
  console.log(`# ${digest.title}`);
  console.log(
    `window ${digest.windowStart.slice(0, 10)} → ${digest.windowEnd.slice(0, 10)}, ` +
      `${digest.items.length} items, ${digest.omitted} omitted, ${digest.sourcesScanned} sources`,
  );
  for (const item of digest.items) {
    console.log(`- [${item.priority}] ${item.title} — ${item.sourceName} (${item.severity})`);
    console.log(`  ${item.summary}`);
    if (item.whyItMatters) console.log(`  Why: ${item.whyItMatters}`);
    console.log(`  ${item.url}`);
  }
}

async function run(options: RunOptions): Promise<void> {
  const { root, pipeline, sources } = loadConfig();
  const stateDir = path.join(root, pipeline.paths.stateDir);
  const state = loadState(stateDir);
  const now = new Date();

  console.log(`scanning ${sources.length} sources`);
  const collected = await collectAll(sources, pipeline, state, now);
  if (collected.errors.length > 0) {
    for (const error of collected.errors) console.warn(`source failed -> ${error}`);
  }
  console.log(`collected ${collected.items.length} new items`);

  mergeIntoBuffer(state, collected.items);

  if (state.buffer.length === 0) {
    console.log("nothing pending; skipping");
    if (!options.dryRun) saveState(stateDir, state);
    return;
  }

  console.log("enriching items");
  const enriched = await enrich(state.buffer, pipeline);
  const start = windowStart(state, pipeline, now);
  const qualifying = enriched.filter(
    (item) => item.qualifying && new Date(item.publishedAt) >= start,
  );

  const forced = dueToPublish(state, pipeline, now);
  if (qualifying.length < pipeline.cadence.minQualifyingItems && !forced) {
    console.log(
      `${qualifying.length} qualifying item(s) < ${pipeline.cadence.minQualifyingItems}; holding until next run`,
    );
    if (!options.dryRun) saveState(stateDir, state);
    return;
  }

  if (qualifying.length === 0) {
    console.log("no qualifying items in window; nothing to publish");
    if (!options.dryRun) saveState(stateDir, state);
    return;
  }

  const selected = selectForDigest(qualifying, pipeline.limits.maxItemsPerDigest);
  const digest = buildDigest(selected.items, selected.omitted, pipeline, start, now, collected.scanned);

  if (options.dryRun) {
    printDryRun(digest);
    return;
  }

  const token = process.env.NOTION_TOKEN;
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!token || !parentPageId) {
    throw new Error("NOTION_TOKEN and NOTION_PARENT_PAGE_ID must be set");
  }

  try {
    const published = await publishDigest(digest, parentPageId, token);
    console.log(`published ${digest.items.length} items -> ${published.url}`);
    state.lastPublishedAt = now.toISOString();
    const publishedIds = new Set(qualifying.map((item) => item.id));
    state.buffer = state.buffer.filter((item) => !publishedIds.has(item.id));
    saveState(stateDir, state);
  } catch (error) {
    const pending = savePending(stateDir, digest);
    saveState(stateDir, state);
    throw new Error(`Notion publish failed (buffered at ${pending}): ${(error as Error).message}`);
  }

  if (collected.errors.length > 0) process.exitCode = 1;
}

function printSchedule(): void {
  console.log(
    [
      "Install a daily LaunchAgent that starts Docker, then runs the digest.",
      "",
      "1. Create ~/Library/LaunchAgents/com.local.security-digest.plist with:",
      "   ProgramArguments: /bin/zsh <repo>/scripts/run.sh",
      "   StartCalendarInterval: Hour 7, Minute 30",
      "2. Load it:",
      "   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.local.security-digest.plist",
      "",
      "scripts/run.sh starts Docker Desktop, waits for `docker info`,",
      "then runs `docker agent run --exec agents/digest.yaml`.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "run";

  if (command === "run") {
    await run({ dryRun: args.includes("--dry-run") });
    return;
  }

  if (command === "reset") {
    const { root, pipeline } = loadConfig();
    resetState(path.join(root, pipeline.paths.stateDir));
    console.log("state cleared");
    return;
  }

  if (command === "schedule") {
    printSchedule();
    return;
  }

  console.log("usage: newsletter <run [--dry-run] | reset | schedule>");
  process.exitCode = 2;
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
