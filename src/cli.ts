import path from "node:path";
import { collectAll } from "./collector";
import { loadConfig } from "./config";
import { enrich } from "./enrich";
import { runPipeline } from "./pipeline";
import { publishDigest } from "./render/notion";
import { listPending, loadState, removePending, resetState, savePending, saveState } from "./state/store";
import type { Digest } from "./types";

interface RunOptions {
  dryRun: boolean;
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

  const result = await runPipeline(
    {
      collect: collectAll,
      enrich,
      publish: publishDigest,
      store: {
        load: () => loadState(stateDir),
        save: (state) => saveState(stateDir, state),
        savePending: (digest) => savePending(stateDir, digest),
        listPending: () => listPending(stateDir),
        removePending: (file) => removePending(file),
      },
      now: () => new Date(),
      config: pipeline,
      sources,
      env: { get: (key) => process.env[key] },
      log: (line) => console.log(line),
      warn: (line) => console.warn(line),
    },
    options,
  );

  if (result.status === "dry-run" && result.digest) printDryRun(result.digest);
  if (result.message) console.error(result.message);
  process.exitCode = result.exitCode;
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
