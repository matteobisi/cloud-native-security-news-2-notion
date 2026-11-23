import assert from "node:assert/strict";
import { test } from "node:test";
import { collectGitHub } from "../src/collector/github";
import { collectWebsite } from "../src/collector/website";
import type { FetchLike, SourceConfig } from "../src/types";

const LIMIT = new Date("2026-03-01T00:00:00.000Z");

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

function textResponse(
  body: string,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
    headers: new Headers({ "content-type": "text/html", ...extraHeaders }),
  } as unknown as Response;
}

/** A page whose first 4000 stripped characters are identical for every token. */
function paddedPage(token: string): string {
  return `<html><head><title>Changelog</title></head><body>${"padding ".repeat(600)}${token}</body></html>`;
}

function githubSource(): SourceConfig {
  return {
    key: "cloud-native-k8s:example",
    name: "example",
    url: "https://github.com/example/example",
    type: "github_release",
    category: "cloud-native-k8s",
    priority: "CRITICAL",
  };
}

function websiteSource(): SourceConfig {
  return {
    key: "security-tools:blog",
    name: "blog",
    url: "https://example.com/changelog",
    type: "website",
    category: "security-tools",
    priority: "HIGH",
  };
}

const RELEASES = [
  {
    id: 2,
    name: "v2.0.0 — CVE-2026-1234 patched",
    tag_name: "v2.0.0",
    html_url: "https://github.com/example/example/releases/tag/v2.0.0",
    body: "Fixes a vulnerability.",
    published_at: "2026-03-10T12:00:00.000Z",
    created_at: "2026-03-10T11:00:00.000Z",
  },
  {
    id: 1,
    name: null,
    tag_name: "v1.0.0",
    html_url: "https://github.com/example/example/releases/tag/v1.0.0",
    body: null,
    published_at: "2026-02-01T00:00:00.000Z",
    created_at: "2026-02-01T00:00:00.000Z",
  },
];

test("github adapter maps releases into items and drops those before the window", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    return jsonResponse(RELEASES);
  };

  const items = await collectGitHub(githubSource(), LIMIT, 5, fetchImpl);

  assert.deepEqual(
    items.map((item) => item.id),
    ["cloud-native-k8s:example:2"],
  );
  assert.equal(items[0].title, "v2.0.0 — CVE-2026-1234 patched");
  assert.equal(items[0].url, "https://github.com/example/example/releases/tag/v2.0.0");
  assert.equal(items[0].publishedAt, "2026-03-10T12:00:00.000Z");
  assert.equal(items[0].text, "Fixes a vulnerability.");
  assert.equal(items[0].priority, "CRITICAL");
  assert.equal(items[0].category, "cloud-native-k8s");
  assert.equal(
    calls[0],
    "https://api.github.com/repos/example/example/releases?per_page=5",
  );
});

test("github adapter falls back to the tag name when a release has no name", async () => {
  const fetchImpl: FetchLike = async () => jsonResponse([RELEASES[1]]);

  const items = await collectGitHub(githubSource(), new Date("2026-01-01T00:00:00.000Z"), 5, fetchImpl);

  assert.equal(items[0].title, "v1.0.0");
  assert.equal(items[0].text, "");
});

test("github adapter reports non-OK responses", async () => {
  const fetchImpl: FetchLike = async () => jsonResponse({ message: "Not Found" }, 404);

  await assert.rejects(() => collectGitHub(githubSource(), LIMIT, 5, fetchImpl), {
    message: "GitHub example/example responded 404",
  });
});

const CHANGELOG = "<html><head><title>Changelog</title></head><body>v2.0.0 released</body></html>";

test("website adapter emits an item the first time it sees a page", async () => {
  const fetchImpl: FetchLike = async () => textResponse(CHANGELOG);

  const result = await collectWebsite(websiteSource(), undefined, fetchImpl);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Changelog");
  assert.equal(result.items[0].text, "Changelog v2.0.0 released");
  assert.match(result.seenId, /^[0-9a-f]{64}$/);
  assert.equal(result.items[0].id, `security-tools:blog:${result.seenId}`);
});

test("website adapter emits nothing when the page hash is unchanged", async () => {
  const fetchImpl: FetchLike = async () => textResponse(CHANGELOG);
  const first = await collectWebsite(websiteSource(), undefined, fetchImpl);

  const second = await collectWebsite(websiteSource(), first.seenId, fetchImpl);

  assert.deepEqual(second.items, []);
  assert.equal(second.seenId, first.seenId);
});

test("website adapter emits a new item when the page content changes", async () => {
  const first = await collectWebsite(
    websiteSource(),
    undefined,
    async () => textResponse(CHANGELOG),
  );
  const changed = CHANGELOG.replace("v2.0.0 released", "v2.1.0 released");

  const second = await collectWebsite(websiteSource(), first.seenId, async () =>
    textResponse(changed),
  );

  assert.equal(second.items.length, 1);
  assert.notEqual(second.seenId, first.seenId);
});

test("website adapter reports non-OK responses", async () => {
  const fetchImpl: FetchLike = async () => textResponse("oops", 500);

  await assert.rejects(() => collectWebsite(websiteSource(), undefined, fetchImpl), {
    message: "blog responded 500",
  });
});

test("website adapter hashes the full text but stores only the truncated text", async () => {
  const first = await collectWebsite(websiteSource(), undefined, async () =>
    textResponse(paddedPage("v2.0.0")),
  );

  assert.equal(first.items[0].text.length, 4000);

  const second = await collectWebsite(websiteSource(), first.seenId, async () =>
    textResponse(paddedPage("v2.1.0")),
  );

  assert.equal(second.items.length, 1);
  assert.notEqual(second.seenId, first.seenId);
  assert.equal(second.items[0].text, first.items[0].text);
});

test("website adapter uses the Last-Modified header as publishedAt", async () => {
  const result = await collectWebsite(websiteSource(), undefined, async () =>
    textResponse(CHANGELOG, 200, { "Last-Modified": "Tue, 10 Mar 2026 12:00:00 GMT" }),
  );

  assert.equal(result.items[0].publishedAt, "2026-03-10T12:00:00.000Z");
});

test("website adapter falls back to now when Last-Modified is missing or unparseable", async () => {
  const before = Date.now();
  const missing = await collectWebsite(websiteSource(), undefined, async () =>
    textResponse(CHANGELOG),
  );
  const unparseable = await collectWebsite(websiteSource(), undefined, async () =>
    textResponse(CHANGELOG, 200, { "Last-Modified": "not-a-date" }),
  );

  for (const result of [missing, unparseable]) {
    const stamp = new Date(result.items[0].publishedAt).getTime();
    assert.ok(stamp >= before - 1000 && stamp <= Date.now() + 1000, result.items[0].publishedAt);
  }
});
