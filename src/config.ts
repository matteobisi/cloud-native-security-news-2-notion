import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { PipelineConfig, Priority, SourceConfig, SourceType } from "./types";

interface SourceFile {
  category?: string;
  priority?: string;
  sources?: Array<{
    name?: string;
    url?: string;
    type?: string;
    notes?: string;
  }>;
}

function loadEnvFile(root: string): void {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function readPipeline(root: string): PipelineConfig {
  const file = path.join(root, "config", "pipeline.yaml");
  const doc = parse(fs.readFileSync(file, "utf8")) as PipelineConfig;
  doc.model.baseUrl =
    process.env.MODEL_BASE_URL || process.env.LLM_URL || doc.model.baseUrl;
  doc.model.name = process.env.MODEL_NAME || process.env.LLM_MODEL || doc.model.name;
  return doc;
}

function readSources(root: string, pipeline: PipelineConfig): SourceConfig[] {
  const dir = path.join(root, pipeline.paths.sourcesDir);
  const wanted = new Set(pipeline.categories);
  const sources: SourceConfig[] = [];

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const doc = parse(fs.readFileSync(path.join(dir, file), "utf8")) as SourceFile;
    const category = doc.category;
    const priority = doc.priority as Priority | undefined;
    if (!category || !priority || !wanted.has(category)) continue;

    for (const source of doc.sources ?? []) {
      if (!source.name || !source.url || !source.type) continue;
      const type = source.type as SourceType;
      if (type === "mailing_list") continue;
      sources.push({
        key: `${category}:${source.name}`,
        name: source.name,
        url: source.url,
        type,
        category,
        priority,
        notes: source.notes,
      });
    }
  }

  return sources;
}

export interface LoadedConfig {
  root: string;
  pipeline: PipelineConfig;
  sources: SourceConfig[];
}

export function loadConfig(root = process.cwd()): LoadedConfig {
  loadEnvFile(root);
  const pipeline = readPipeline(root);
  const sources = readSources(root, pipeline);
  return { root, pipeline, sources };
}
