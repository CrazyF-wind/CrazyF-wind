#!/usr/bin/env node
// Render a combined contributions card for the personal account and the
// partner organizations: default-branch commits, pull requests, issues and stars.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  PRIMARY_OWNER,
  collectRepos,
  getAll,
  getJson,
  isOwnCommit,
  resolveOwners,
} from './lib/github.mjs';

const OUTPUT = resolve('assets/contributions.svg');

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const integer = new Intl.NumberFormat('en-US');

function renderSvg(counts, { repos, owners }) {
  const width = 495;
  const height = 152;
  const padding = 20;
  const tileWidth = (width - padding * 2) / 4;
  const subtitle = `${owners.join(' · ')} · ${repos} public repos`;

  const tiles = [
    ['Commits', counts.commits],
    ['Pull Requests', counts.pulls],
    ['Issues', counts.issues],
    ['Stars', counts.stars],
  ]
    .map(([label, value], index) => {
      const x = padding + tileWidth * (index + 0.5);
      return [
        `  <text class="number" x="${x}" y="105" text-anchor="middle">${integer.format(value)}</text>`,
        `  <text class="label" x="${x}" y="126" text-anchor="middle">${escapeXml(label)}</text>`,
      ].join('\n');
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Contributions across ${escapeXml(owners.join(', '))}">
  <style>
    .title { fill: #1f2328; font: 600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .subtitle { fill: #57606a; font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .number { fill: #1f2328; font: 600 24px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .label { fill: #57606a; font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    @media (prefers-color-scheme: dark) {
      .title, .number { fill: #e6edf3; }
      .subtitle, .label { fill: #8b949e; }
    }
  </style>
  <text class="title" x="20" y="30">Contributions</text>
  <text class="subtitle" x="20" y="48">${escapeXml(subtitle)}</text>
${tiles}
</svg>
`;
}

async function main() {
  const owners = resolveOwners();
  const repos = await collectRepos(owners);
  const user = await getJson(`/users/${PRIMARY_OWNER}`);
  const since = user?.created_at ? new Date(user.created_at).toISOString() : undefined;
  const login = PRIMARY_OWNER.toLowerCase();

  const counts = { commits: 0, pulls: 0, issues: 0, stars: 0 };

  for (const repo of repos) {
    const fullName = repo.full_name;
    const branch = encodeURIComponent(repo.default_branch || 'HEAD');
    const commitPath = `/repos/${fullName}/commits?sha=${branch}${since ? `&since=${since}` : ''}`;

    const [commits, pulls, issues] = await Promise.all([
      getAll(commitPath),
      getAll(`/repos/${fullName}/pulls?state=all`),
      getAll(`/repos/${fullName}/issues?state=all`),
    ]);

    counts.commits += commits.filter(isOwnCommit).length;
    counts.pulls += pulls.filter((pull) => pull.user?.login?.toLowerCase() === login).length;
    counts.issues += issues.filter(
      (issue) => !issue.pull_request && issue.user?.login?.toLowerCase() === login,
    ).length;
    // Stars are a repository metric and cannot be attributed to a single author.
    counts.stars += repo.stargazers_count ?? 0;
  }

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, renderSvg(counts, { repos: repos.length, owners }), 'utf8');

  console.log(`Wrote ${OUTPUT}`);
  console.log(`Repos: ${repos.length} (${owners.join(', ')})`);
  console.log(`Commits: ${counts.commits}`);
  console.log(`Pull requests: ${counts.pulls}`);
  console.log(`Issues: ${counts.issues}`);
  console.log(`Stars: ${counts.stars}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
