import type { FetchLike, Item, SourceConfig } from "../types";

const GITHUB_API = "https://api.github.com";

export function repoFromUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

interface GitHubRelease {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string;
  body: string | null;
  published_at: string | null;
  created_at: string;
}

export async function collectGitHub(
  source: SourceConfig,
  since: Date,
  perSource: number,
  fetchImpl: FetchLike = fetch,
): Promise<Item[]> {
  const repo = repoFromUrl(source.url);
  if (!repo) return [];

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "cloud-native-security-news-digest",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetchImpl(
    `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/releases?per_page=${perSource}`,
    { headers, signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) {
    throw new Error(`GitHub ${repo.owner}/${repo.repo} responded ${res.status}`);
  }

  const releases = (await res.json()) as GitHubRelease[];
  return releases
    .filter((release) => {
      const published = release.published_at || release.created_at;
      return new Date(published) >= since;
    })
    .map((release) => ({
      id: `${source.key}:${release.id}`,
      sourceKey: source.key,
      sourceName: source.name,
      category: source.category,
      priority: source.priority,
      type: source.type,
      title: release.name || release.tag_name,
      url: release.html_url,
      publishedAt: release.published_at || release.created_at,
      text: release.body || "",
    }));
}
