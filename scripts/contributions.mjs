#!/usr/bin/env node
// Render a contributions card broken down by owner: the personal account and
// each partner organization, counting default-branch commits, pull requests
// and issues authored by the profile owner.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRIMARY_OWNER,
  getAll,
  isOwnCommit,
  listRepos,
  resolveOwners,
} from './lib/github.mjs';

const OUTPUT = resolve('assets/contributions.svg');

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const integer = new Intl.NumberFormat('en-US');

const COLUMNS = [
  { key: 'commits', label: 'Commits', x: 330 },
  { key: 'pulls', label: 'PRs', x: 410 },
  { key: 'issues', label: 'Issues', x: 475 },
];

export function renderSvg({ rows, repoCount }) {
  const width = 495;
  const rowHeight = 30;
  const headerY = 76;
  const firstRowY = 108;
  const dividerY = firstRowY + rows.length * rowHeight - 12;
  const totalY = dividerY + 20;
  const height = totalY + 20;

  const totals = rows.reduce(
    (sum, row) => ({
      commits: sum.commits + row.commits,
      pulls: sum.pulls + row.pulls,
      issues: sum.issues + row.issues,
    }),
    { commits: 0, pulls: 0, issues: 0 },
  );

  const headerCells = COLUMNS.map(
    (column) =>
      `  <text class="header" x="${column.x}" y="${headerY}" text-anchor="end">${column.label}</text>`,
  ).join('\n');

  const body = rows
    .map((row, index) => {
      const y = firstRowY + index * rowHeight;
      const cells = COLUMNS.map(
        (column) =>
          `  <text class="value" x="${column.x}" y="${y}" text-anchor="end">${integer.format(row[column.key])}</text>`,
      ).join('\n');
      return [
        `  <text class="owner" x="20" y="${y}">${escapeXml(row.owner)}</text>`,
        cells,
      ].join('\n');
    })
    .join('\n');

  const totalCells = COLUMNS.map(
    (column) =>
      `  <text class="total-value" x="${column.x}" y="${totalY}" text-anchor="end">${integer.format(totals[column.key])}</text>`,
  ).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Contributions by organization across ${escapeXml(rows.map((row) => row.owner).join(', '))}">
  <style>
    .title { fill: #1f2328; font: 600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .subtitle { fill: #57606a; font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .header { fill: #57606a; font: 600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .owner { fill: #1f2328; font: 500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .value { fill: #1f2328; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .total-label { fill: #1f2328; font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .total-value { fill: #1f2328; font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .divider { stroke: #d0d7de; stroke-width: 1; }
    @media (prefers-color-scheme: dark) {
      .title, .owner, .value, .total-label, .total-value { fill: #e6edf3; }
      .subtitle, .header { fill: #8b949e; }
      .divider { stroke: #30363d; }
    }
  </style>
  <text class="title" x="20" y="30">Contributions by organization</text>
  <text class="subtitle" x="20" y="48">${escapeXml(`${rows.length} owners · ${repoCount} public repos`)}</text>
${headerCells}
  <line class="divider" x1="20" y1="88" x2="${width - 20}" y2="88" />
${body}
  <line class="divider" x1="20" y1="${dividerY}" x2="${width - 20}" y2="${dividerY}" />
  <text class="total-label" x="20" y="${totalY}">Total</text>
${totalCells}
</svg>
`;
}

export function isStatsRepo(repo) {
  return !repo.fork && repo.name !== '.github';
}

async function countOwner(owner, login) {
  const repos = (await listRepos(owner)).filter(isStatsRepo);
  const counts = { owner, commits: 0, pulls: 0, issues: 0 };

  for (const repo of repos) {
    const fullName = repo.full_name;
    const branch = encodeURIComponent(repo.default_branch || 'HEAD');
    const commitPath = `/repos/${fullName}/commits?sha=${branch}`;

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
  }

  return { counts, repoCount: repos.length };
}

async function main() {
  const owners = resolveOwners();
  const login = PRIMARY_OWNER.toLowerCase();

  const rows = [];
  let repoCount = 0;
  for (const owner of owners) {
    const result = await countOwner(owner, login);
    rows.push(result.counts);
    repoCount += result.repoCount;
  }

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, renderSvg({ rows, repoCount }), 'utf8');

  console.log(`Wrote ${OUTPUT}`);
  console.log(`Owners: ${owners.join(', ')}`);
  console.log(`Repos: ${repoCount}`);
  for (const row of rows) {
    console.log(
      `${row.owner}: ${row.commits} commits, ${row.pulls} pull requests, ${row.issues} issues`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
