// Shared helpers for the profile stats scripts.

export const API = 'https://api.github.com';

const DEFAULT_OWNERS = ['CrazyF-wind', 'tavorit-dev', 'Open-Multiverse'];

const token = process.env.GITHUB_TOKEN;
const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'profile-stats-card',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

export function resolveOwners() {
  const raw = process.env.OWNERS || DEFAULT_OWNERS.join(',');
  return raw
    .split(',')
    .map((owner) => owner.trim())
    .filter(Boolean);
}

async function request(path) {
  return fetch(`${API}${path}`, { headers });
}

export async function getJson(path) {
  const response = await request(path);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// Counts a paginated collection without downloading it: `per_page=1` turns the
// `rel="last"` page number into the total item count.
export async function getCount(path) {
  const response = await request(path);
  if (response.status === 404 || response.status === 409) return 0;
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  }
  const last = response.headers.get('link')?.match(/[?&]page=(\d+)>;\s*rel="last"/);
  if (last) return Number(last[1]);
  const items = await response.json();
  return Array.isArray(items) ? items.length : 0;
}

async function listRepos(owner) {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const orgBatch = await getJson(`/orgs/${owner}/repos?type=public&per_page=100&page=${page}`);
    const batch =
      orgBatch ?? (await getJson(`/users/${owner}/repos?type=owner&per_page=100&page=${page}`));
    if (!batch || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

// Public, non-fork repositories across every owner, deduplicated.
// `.github` repos only hold profile metadata and are skipped.
export async function collectRepos(owners) {
  const seen = new Set();
  const repos = [];
  for (const owner of owners) {
    for (const repo of await listRepos(owner)) {
      if (repo.fork || repo.name === '.github' || seen.has(repo.full_name)) continue;
      seen.add(repo.full_name);
      repos.push(repo);
    }
  }
  return repos;
}
