import assert from "node:assert/strict";
import { test } from "node:test";
import { collectGitHub } from "../src/collector/github";
import { collectJsonFeed } from "../src/collector/jsonfeed";
import { collectRss } from "../src/collector/rss";
import { collectWebsite } from "../src/collector/website";
import type { FetchLike, SourceConfig } from "../src/types";

const LIMIT = new Date("2026-03-01T00:00:00.000Z");

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ "content-type": "application/json", ...extraHeaders }),
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

function githubSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    key: "cloud-native-k8s:example",
    name: "example",
    url: "https://github.com/example/example",
    type: "github_release",
    category: "cloud-native-k8s",
    priority: "CRITICAL",
    ...overrides,
  };
}

function rssSource(): SourceConfig {
  return {
    key: "ci-cd-gitops:Jenkins",
    name: "Jenkins",
    url: "https://www.jenkins.io/changelog-stable/rss.xml",
    type: "rss",
    category: "ci-cd-gitops",
    priority: "HIGH",
  };
}

function jsonFeedSource(): SourceConfig {
  return {
    key: "cloud-native-k8s:Kubernetes CVE feed",
    name: "Kubernetes CVE feed",
    url: "https://kubernetes.io/docs/reference/issues-security/official-cve-feed/index.json",
    type: "json_feed",
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

  const result = await collectGitHub(githubSource(), LIMIT, 5, fetchImpl);

  assert.deepEqual(
    result.items.map((item) => item.id),
    ["cloud-native-k8s:example:2"],
  );
  assert.equal(result.items[0].title, "v2.0.0 — CVE-2026-1234 patched");
  assert.equal(result.items[0].url, "https://github.com/example/example/releases/tag/v2.0.0");
  assert.equal(result.items[0].publishedAt, "2026-03-10T12:00:00.000Z");
  assert.equal(result.items[0].text, "Fixes a vulnerability.");
  assert.equal(result.items[0].priority, "CRITICAL");
  assert.equal(result.items[0].category, "cloud-native-k8s");
  assert.equal(
    calls[0],
    "https://api.github.com/repos/example/example/releases?per_page=100",
  );
});

test("github adapter falls back to the tag name when a release has no name", async () => {
  const fetchImpl: FetchLike = async () => jsonResponse([RELEASES[1]]);

  const result = await collectGitHub(
    githubSource(),
    new Date("2026-01-01T00:00:00.000Z"),
    5,
    fetchImpl,
  );

  assert.equal(result.items[0].title, "v1.0.0");
  assert.equal(result.items[0].text, "");
});

test("github adapter reports non-OK responses", async () => {
  const fetchImpl: FetchLike = async () => jsonResponse({ message: "Not Found" }, 404);

  await assert.rejects(() => collectGitHub(githubSource(), LIMIT, 5, fetchImpl), {
    message: "GitHub example/example responded 404",
  });
});

test("github adapter drops drafts and prereleases unless the source opts in", async () => {
  const releases = [
    { ...RELEASES[0], id: 10, draft: true },
    { ...RELEASES[0], id: 11, prerelease: true },
    { ...RELEASES[0], id: 12 },
  ];
  const fetchImpl: FetchLike = async () => jsonResponse(releases);

  const standard = await collectGitHub(githubSource(), LIMIT, 5, fetchImpl);
  assert.deepEqual(standard.items.map((item) => item.id), ["cloud-native-k8s:example:12"]);

  const opted = await collectGitHub(
    githubSource({ includePrereleases: true }),
    LIMIT,
    5,
    fetchImpl,
  );
  assert.deepEqual(
    opted.items.map((item) => item.id),
    ["cloud-native-k8s:example:11", "cloud-native-k8s:example:12"],
  );
});

test("github adapter records a validator and treats 304 as unchanged", async () => {
  const seen: Array<Record<string, string>> = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    seen.push((init?.headers ?? {}) as Record<string, string>);
    if (seen.length === 1) {
      return jsonResponse(RELEASES, 200, { etag: '"abc"' });
    }
    return jsonResponse({}, 304);
  };

  const first = await collectGitHub(githubSource(), LIMIT, 5, fetchImpl);
  assert.equal(first.etag, '"abc"');

  const second = await collectGitHub(githubSource(), LIMIT, 5, fetchImpl, first.etag);
  assert.deepEqual(second.items, []);
  assert.equal(second.etag, '"abc"');
  assert.equal(seen[1]["If-None-Match"], '"abc"');
});

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Jenkins changelog</title>
    <item>
      <title>Jenkins 2.500 — CVE-2026-1234</title>
      <link>https://www.jenkins.io/changelog-stable/#v2.500</link>
      <guid>jenkins-2.500</guid>
      <pubDate>Tue, 10 Mar 2026 12:00:00 GMT</pubDate>
      <description>&lt;p&gt;Fixes a &lt;b&gt;vulnerability&lt;/b&gt;.&lt;/p&gt;</description>
    </item>
    <item>
      <title>Jenkins 1.0</title>
      <link>https://www.jenkins.io/changelog-stable/#v1.0</link>
      <guid>jenkins-1.0</guid>
      <pubDate>Sun, 01 Feb 2026 00:00:00 GMT</pubDate>
      <description>Old release.</description>
    </item>
    <item>
      <title>Undated entry</title>
      <link>https://www.jenkins.io/changelog-stable/#undated</link>
      <guid>jenkins-undated</guid>
      <description>No date.</description>
    </item>
  </channel>
</rss>`;

test("rss adapter parses dated entries and skips old or undated ones", async () => {
  const fetchImpl: FetchLike = async () => textResponse(RSS, 200, { etag: '"rss-1"' });

  const result = await collectRss(rssSource(), LIMIT, 10, fetchImpl);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "ci-cd-gitops:Jenkins:jenkins-2.500");
  assert.equal(result.items[0].title, "Jenkins 2.500 — CVE-2026-1234");
  assert.equal(result.items[0].url, "https://www.jenkins.io/changelog-stable/#v2.500");
  assert.equal(result.items[0].publishedAt, "2026-03-10T12:00:00.000Z");
  assert.equal(result.items[0].text, "Fixes a vulnerability.");
  assert.equal(result.etag, '"rss-1"');
});

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>GitLab releases</title>
  <entry>
    <title>GitLab 18.0 released</title>
    <link rel="alternate" href="https://about.gitlab.com/releases/2026/03/10/gitlab-18-0-released/"/>
    <id>tag:about.gitlab.com,2026-03-10:gitlab-18-0</id>
    <updated>2026-03-10T00:00:00Z</updated>
    <summary>Security fixes and features.</summary>
  </entry>
</feed>`;

test("rss adapter parses Atom entries", async () => {
  const result = await collectRss(
    rssSource(),
    LIMIT,
    10,
    async () => textResponse(ATOM),
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "ci-cd-gitops:Jenkins:tag:about.gitlab.com,2026-03-10:gitlab-18-0");
  assert.equal(result.items[0].url, "https://about.gitlab.com/releases/2026/03/10/gitlab-18-0-released/");
  assert.equal(result.items[0].publishedAt, "2026-03-10T00:00:00.000Z");
  assert.equal(result.items[0].text, "Security fixes and features.");
});

test("rss adapter reports non-OK responses", async () => {
  await assert.rejects(
    () => collectRss(rssSource(), LIMIT, 10, async () => textResponse("oops", 503)),
    { message: "Jenkins responded 503" },
  );
});

const JSON_FEED = {
  version: "https://jsonfeed.org/version/1.1",
  title: "Kubernetes CVE feed",
  items: [
    {
      id: "https://github.com/kubernetes/kubernetes/issues/143852",
      url: "https://github.com/kubernetes/kubernetes/issues/143852",
      content_text: "CVSS Rating: 7.5 (HIGH). A security issue was discovered in ingress-nginx.",
      date_published: "2026-03-10T17:21:19Z",
    },
    {
      id: "https://github.com/kubernetes/kubernetes/issues/1",
      url: "https://github.com/kubernetes/kubernetes/issues/1",
      content_text: "Old CVE.",
      date_published: "2026-01-01T00:00:00Z",
    },
  ],
};

test("json feed adapter maps dated entries and skips those outside the window", async () => {
  const result = await collectJsonFeed(
    jsonFeedSource(),
    LIMIT,
    10,
    async () => jsonResponse(JSON_FEED),
  );

  assert.equal(result.items.length, 1);
  assert.equal(
    result.items[0].id,
    "cloud-native-k8s:Kubernetes CVE feed:https://github.com/kubernetes/kubernetes/issues/143852",
  );
  assert.equal(result.items[0].title, "Kubernetes CVE feed");
  assert.equal(result.items[0].url, "https://github.com/kubernetes/kubernetes/issues/143852");
  assert.equal(result.items[0].publishedAt, "2026-03-10T17:21:19.000Z");
  assert.match(result.items[0].text, /CVSS Rating/);
});

test("json feed adapter rejects a document that is not a JSON Feed", async () => {
  await assert.rejects(
    () => collectJsonFeed(jsonFeedSource(), LIMIT, 10, async () => jsonResponse({ items: "nope" })),
    { message: "Kubernetes CVE feed is not a JSON Feed" },
  );
});

test("json feed adapter reports non-OK responses", async () => {
  await assert.rejects(
    () => collectJsonFeed(jsonFeedSource(), LIMIT, 10, async () => jsonResponse({}, 500)),
    { message: "Kubernetes CVE feed responded 500" },
  );
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
