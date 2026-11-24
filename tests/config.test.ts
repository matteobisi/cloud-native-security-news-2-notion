import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config";

const PIPELINE = `
cadence:
  minQualifyingItems: 3
  forcePublishAfterDays: 30
  maxWindowDays: 35
  bootstrapWindowDays: 7
limits:
  maxItemsPerDigest: 25
  maxItemsPerSource: 10
model:
  baseUrl: http://localhost:12434/engines/v1
  name: test-model
  temperature: 0.2
  maxTokens: 4096
securitySignals:
  - CVE-
paths:
  sourcesDir: config/sources
  stateDir: state
`;

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "digest-config-"));
  fs.mkdirSync(path.join(root, "config", "sources"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "pipeline.yaml"), PIPELINE);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, "config", "sources", name), body);
  }
  return root;
}

function registry(body: string, category = "cloud-native-k8s", priority = "CRITICAL"): string {
  return `category: ${category}\npriority: ${priority}\n\nsources:\n${body}`;
}

test("loads enabled files and skips dormant files and entries", () => {
  const root = fixture({
    "k8s.yaml": registry(`
  - name: Kubernetes
    url: https://github.com/kubernetes/kubernetes/releases
    type: github_release
  - name: parked
    url: https://github.com/example/parked/releases
    type: github_release
    enabled: false
`),
    "dormant.yaml": `category: observability\npriority: MEDIUM\nenabled: false\n\nsources:\n  - name: Prometheus\n    url: https://github.com/prometheus/prometheus/releases\n    type: github_release\n`,
  });

  const { sources } = loadConfig(root);

  assert.deepEqual(
    sources.map((source) => source.key),
    ["cloud-native-k8s:Kubernetes"],
  );
});

test("resolves priority per entry, falling back to the file default", () => {
  const root = fixture({
    "tools.yaml": registry(
      `
  - name: inherited
    url: https://github.com/example/inherited/releases
    type: github_release
  - name: overridden
    url: https://github.com/example/overridden/releases
    type: github_release
    priority: MEDIUM
`,
      "security-tools",
      "HIGH",
    ),
  });

  const { sources } = loadConfig(root);

  assert.equal(sources[0].priority, "HIGH");
  assert.equal(sources[1].priority, "MEDIUM");
});

test("treats a missing enabled flag as enabled", () => {
  const root = fixture({
    "k8s.yaml": registry(`
  - name: Kubernetes
    url: https://github.com/kubernetes/kubernetes/releases
    type: github_release
`),
  });

  assert.equal(loadConfig(root).sources.length, 1);
});

test("rejects duplicate endpoints across enabled sources", () => {
  const root = fixture({
    "k8s.yaml": registry(`
  - name: Kubernetes
    url: https://github.com/kubernetes/kubernetes/releases
    type: github_release
`),
    "compliance.yaml": registry(
      `
  - name: Kubernetes mirror
    url: https://GitHub.com/kubernetes/kubernetes/releases/
    type: github_release
`,
      "compliance-scanning",
      "HIGH",
    ),
  });

  assert.throws(() => loadConfig(root), /duplicate endpoint/);
});

test("allows a repeated endpoint when one side is dormant", () => {
  const root = fixture({
    "k8s.yaml": registry(`
  - name: Kubernetes
    url: https://github.com/kubernetes/kubernetes/releases
    type: github_release
`),
    "dormant.yaml": `category: observability\npriority: MEDIUM\nenabled: false\n\nsources:\n  - name: Kubernetes\n    url: https://github.com/kubernetes/kubernetes/releases\n    type: github_release\n`,
  });

  assert.equal(loadConfig(root).sources.length, 1);
});

test("rejects retired source types by name", () => {
  const root = fixture({
    "k8s.yaml": registry(`
  - name: KEPs
    url: https://github.com/kubernetes/enhancements
    type: github_repo
`),
  });

  assert.throws(() => loadConfig(root), /unknown type "github_repo"/);
});

test("rejects duplicate names within one category", () => {
  const root = fixture({
    "k8s.yaml": registry(`
  - name: Kubernetes
    url: https://github.com/kubernetes/kubernetes/releases
    type: github_release
  - name: Kubernetes
    url: https://github.com/kubernetes/kubernetes/releases
    type: github_release
`),
  });

  assert.throws(() => loadConfig(root), /duplicate name "Kubernetes"/);
});

test("rejects a category declared in two files", () => {
  const root = fixture({
    "a.yaml": registry(`
  - name: one
    url: https://github.com/example/one/releases
    type: github_release
`),
    "b.yaml": registry(
      `
  - name: two
    url: https://github.com/example/two/releases
    type: github_release
`,
      "cloud-native-k8s",
      "HIGH",
    ),
  });

  assert.throws(() => loadConfig(root), /category "cloud-native-k8s"/);
});

test("rejects an invalid priority and reports every problem at once", () => {
  const root = fixture({
    "k8s.yaml": registry(`
  - name: one
    url: https://github.com/example/one/releases
    type: github_release
    priority: URGENT
  - name: two
    url: https://github.com/example/two/releases
    type: unknown_feed
`),
  });

  assert.throws(
    () => loadConfig(root),
    /invalid priority "URGENT"[\s\S]*unknown type "unknown_feed"/,
  );
});

test("the repository's real registry loads", () => {
  const { sources, pipeline } = loadConfig(process.cwd());

  assert.ok(sources.length > 40);
  assert.equal(pipeline.cadence.minQualifyingItems, 3);
  for (const source of sources) {
    assert.ok(source.name.length > 0);
    assert.ok(["github_release", "rss", "json_feed", "website"].includes(source.type));
  }
  assert.ok(sources.some((source) => source.name === "Kubernetes CVE feed" && source.type === "json_feed"));
  assert.ok(sources.some((source) => source.name === "Jenkins security advisories" && source.type === "rss"));
});
