import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listPending, loadState, removePending, resetState, savePending, saveState } from "../src/state/store";
import type { Digest, Item } from "../src/types";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "digest-state-"));
}

function item(): Item {
  return {
    id: "cloud-native-k8s:example:1",
    sourceKey: "cloud-native-k8s:example",
    sourceName: "example",
    category: "cloud-native-k8s",
    priority: "CRITICAL",
    type: "github_release",
    title: "v1.0.0",
    url: "https://example.com/v1",
    publishedAt: "2026-03-10T00:00:00.000Z",
    text: "",
  };
}

test("loadState returns empty state when nothing has been saved", () => {
  assert.deepEqual(loadState(tempDir()), { sources: {}, buffer: [] });
});

test("saveState and loadState round-trip the buffer and last publish", () => {
  const dir = tempDir();
  saveState(dir, {
    sources: { "cloud-native-k8s:example": { lastSeenId: "a", lastSeenAt: "2026-03-10T00:00:00.000Z" } },
    buffer: [item()],
    lastPublishedAt: "2026-03-01T00:00:00.000Z",
  });

  const loaded = loadState(dir);

  assert.equal(loaded.buffer[0].id, "cloud-native-k8s:example:1");
  assert.equal(loaded.sources["cloud-native-k8s:example"].lastSeenId, "a");
  assert.equal(loaded.lastPublishedAt, "2026-03-01T00:00:00.000Z");
});

test("loadState recovers from a corrupt state file", () => {
  const dir = tempDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), "{not json");

  assert.deepEqual(loadState(dir), { sources: {}, buffer: [] });
});

test("savePending writes the digest to a pending file", () => {
  const dir = tempDir();
  const digest: Digest = {
    title: "Digest",
    date: "2026-03-31T00:00:00.000Z",
    windowStart: "2026-03-24T00:00:00.000Z",
    windowEnd: "2026-03-31T00:00:00.000Z",
    items: [],
    omitted: 0,
    sourcesScanned: 1,
    model: "ai/gemma3:12b-q4_K_M",
  };

  const file = savePending(dir, digest);

  assert.ok(fs.existsSync(file));
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).title, "Digest");
});

test("listPending round-trips saved digests and removePending deletes them", () => {
  const dir = tempDir();
  const digest: Digest = {
    title: "Digest",
    date: "2026-03-31T00:00:00.000Z",
    windowStart: "2026-03-24T00:00:00.000Z",
    windowEnd: "2026-03-31T00:00:00.000Z",
    items: [],
    omitted: 0,
    sourcesScanned: 1,
    model: "ai/gemma3:12b-q4_K_M",
  };

  const file = savePending(dir, digest);
  const pending = listPending(dir);

  assert.equal(pending.length, 1);
  assert.equal(pending[0].path, file);
  assert.equal(pending[0].digest.title, "Digest");

  removePending(pending[0].path);

  assert.deepEqual(listPending(dir), []);
  assert.equal(fs.existsSync(file), false);
});

test("listPending returns nothing when no digest is buffered", () => {
  assert.deepEqual(listPending(tempDir()), []);
});

test("resetState clears the state directory", () => {
  const dir = tempDir();
  saveState(dir, { sources: {}, buffer: [item()] });

  resetState(dir);

  assert.equal(fs.existsSync(dir), false);
});
