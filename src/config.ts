import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { canonicalUrl } from "./url";
import type { PipelineConfig, Priority, SourceConfig, SourceType } from "./types";

const SOURCE_TYPES = new Set<SourceType>(["github_release", "rss", "json_feed", "website"]);
const PRIORITIES = new Set<Priority>(["CRITICAL", "HIGH", "MEDIUM"]);

interface SourceEntry {
  name?: string;
  url?: string;
  type?: string;
  priority?: string;
  include_prereleases?: boolean;
  enabled?: boolean;
  notes?: string;
}

interface SourceFile {
  category?: string;
  priority?: string;
  enabled?: boolean;
  sources?: SourceEntry[];
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
    process.env.LLM_URL || process.env.MODEL_BASE_URL || doc.model.baseUrl;
  doc.model.name = process.env.LLM_MODEL || process.env.MODEL_NAME || doc.model.name;
  return doc;
}

function readSources(root: string, pipeline: PipelineConfig): SourceConfig[] {
  const dir = path.join(root, pipeline.paths.sourcesDir);
  const problems: string[] = [];
  const categories = new Map<string, string>();
  const endpoints = new Map<string, { name: string; file: string }>();
  const sources: SourceConfig[] = [];

  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .sort();

  for (const file of files) {
    let doc: SourceFile;
    try {
      doc = parse(fs.readFileSync(path.join(dir, file), "utf8")) as SourceFile;
    } catch (error) {
      problems.push(`${file}: ${(error as Error).message}`);
      continue;
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      problems.push(`${file}: expected a mapping`);
      continue;
    }
    if (doc.enabled === false) continue;

    const category = doc.category;
    if (!category) {
      problems.push(`${file}: missing category`);
      continue;
    }
    const declaredIn = categories.get(category);
    if (declaredIn) {
      problems.push(`${file}: category "${category}" already declared in ${declaredIn}`);
      continue;
    }
    categories.set(category, file);

    if (!PRIORITIES.has(doc.priority as Priority)) {
      problems.push(`${file}: invalid priority "${doc.priority ?? ""}"`);
      continue;
    }
    const filePriority = doc.priority as Priority;

    const names = new Set<string>();
    const entries = doc.sources ?? [];
    for (const [index, entry] of entries.entries()) {
      const where = `${file}: sources[${index}]`;
      if (entry.enabled === false) continue;
      if (!entry.name || !entry.url || !entry.type) {
        problems.push(`${where}: name, url and type are required`);
        continue;
      }
      if (!SOURCE_TYPES.has(entry.type as SourceType)) {
        problems.push(`${where}: unknown type "${entry.type}"`);
        continue;
      }
      const type = entry.type as SourceType;
      if (names.has(entry.name)) {
        problems.push(`${where}: duplicate name "${entry.name}" in category "${category}"`);
        continue;
      }
      names.add(entry.name);

      const priority = (entry.priority ?? filePriority) as Priority;
      if (!PRIORITIES.has(priority)) {
        problems.push(`${where}: invalid priority "${entry.priority}"`);
        continue;
      }
      if (entry.include_prereleases !== undefined && type !== "github_release") {
        problems.push(`${where}: include_prereleases is only valid for github_release`);
        continue;
      }

      const endpoint = canonicalUrl(entry.url);
      const owner = endpoints.get(endpoint);
      if (owner) {
        problems.push(
          `${where}: duplicate endpoint ${entry.url} (already used by "${owner.name}" in ${owner.file})`,
        );
        continue;
      }
      endpoints.set(endpoint, { name: entry.name, file });

      sources.push({
        key: `${category}:${entry.name}`,
        name: entry.name,
        url: entry.url,
        type,
        category,
        priority,
        includePrereleases: entry.include_prereleases === true,
        notes: entry.notes,
      });
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid source registry:\n- ${problems.join("\n- ")}`);
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
