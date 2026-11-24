import fs from "node:fs";
import path from "node:path";
import type { Digest, Item } from "../types";

export interface SourceState {
  lastSeenId?: string;
  lastSeenAt?: string;
  etag?: string;
}

export interface State {
  sources: Record<string, SourceState>;
  buffer: Item[];
  lastPublishedAt?: string;
}

export interface PendingDigest {
  path: string;
  digest: Digest;
}

function emptyState(): State {
  return { sources: {}, buffer: [] };
}

function stateFile(dir: string): string {
  return path.join(dir, "state.json");
}

function isState(value: unknown): value is State {
  if (!value || typeof value !== "object") return false;
  const candidate = value as State;
  return (
    typeof candidate.sources === "object" &&
    candidate.sources !== null &&
    Array.isArray(candidate.buffer)
  );
}

export function loadState(dir: string): State {
  const file = stateFile(dir);
  if (!fs.existsSync(file)) return emptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return isState(parsed) ? parsed : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(dir: string, state: State): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFile(dir), JSON.stringify(state, null, 2));
}

export function resetState(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function pendingDir(dir: string): string {
  return path.join(dir, "pending");
}

export function savePending(dir: string, payload: unknown): string {
  const target = pendingDir(dir);
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, `${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

export function listPending(dir: string): PendingDigest[] {
  const target = pendingDir(dir);
  if (!fs.existsSync(target)) return [];
  return fs
    .readdirSync(target)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      const file = path.join(target, name);
      try {
        return [{ path: file, digest: JSON.parse(fs.readFileSync(file, "utf8")) as Digest }];
      } catch {
        return [];
      }
    });
}

export function removePending(file: string): void {
  fs.rmSync(file, { force: true });
}
