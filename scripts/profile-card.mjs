#!/usr/bin/env node
// Render a profile summary card that aggregates the personal account and the
// partner organizations: repositories, commits by the profile owner, and a
// monthly commit trend over the last few years.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  PRIMARY_OWNER,
  collectRepos,
  getJson,
  isOwnCommit,
  resolveOwners,
} from './lib/github.mjs';

const OUTPUT = resolve('assets/profile-card.svg');
const YEARS = 5;
const integer = new Intl.NumberFormat('en-US');

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function commitsSince(repo, since) {
  const commits = [];
  for (let page = 1; ; page += 1) {
    const batch = await getJson(
      `/repos/${repo.full_name}/commits?sha=${encodeURIComponent(
        repo.default_branch || 'HEAD',
      )}&since=${since}&per_page=100&page=${page}`,
    );
    if (!batch || batch.length === 0) break;
    commits.push(...batch);
    if (batch.length < 100) break;
  }
  return commits;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

function buildMonths(from, to) {
  const months = [];
  for (let time = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1); time <= to.getTime(); ) {
    const date = new Date(time);
    months.push({ key: monthKey(date), year: date.getUTCFullYear(), count: 0 });
    time = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }
  return months;
}

const ICONS = {
  commit: '<circle cx="8" cy="8" r="3.5" /><path d="M0 8h4.5M11.5 8H16" />',
  repo: '<rect x="1.5" y="2" width="13" height="12" rx="2" /><path d="M5 2v12" />',
  clock: '<circle cx="8" cy="8" r="6.5" /><path d="M8 4.5V8l2.5 1.5" />',
};

function renderSvg({ title, subtitle, rows, months, max }) {
  const width = 700;
  const height = 270;

  const rowMarkup = rows
    .map(({ icon, text }, index) => {
      const y = 112 + index * 40;
      return [
        `  <g class="icon" transform="translate(24 ${y - 12})">${ICONS[icon]}</g>`,
        `  <text class="row" x="50" y="${y}">${escapeXml(text)}</text>`,
      ].join('\n');
    })
    .join('\n');

  const x0 = 300;
  const x1 = 676;
  const yTop = 104;
  const yBottom = 220;
  const step = months.length > 1 ? (x1 - x0) / (months.length - 1) : 0;
  const points = months.map((month, index) => ({
    x: x0 + step * index,
    y: yBottom - (month.count / max) * (yBottom - yTop),
    month,
  }));

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${x1} ${yBottom} L${x0} ${yBottom} Z`;

  const grid = [0, 0.5, 1]
    .map((ratio) => {
      const y = yBottom - ratio * (yBottom - yTop);
      return `  <line class="grid" x1="${x0}" y1="${y.toFixed(1)}" x2="${x1}" y2="${y.toFixed(1)}" />`;
    })
    .join('\n');

  const yearLabels = points
    .filter((point) => point.month.key.endsWith('-0'))
    .map(
      (point) =>
        `  <text class="axis" x="${point.x.toFixed(1)}" y="${yBottom + 18}" text-anchor="middle">${point.month.year}</text>`,
    )
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)} profile summary">
  <defs>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2F81F7" stop-opacity="0.45" />
      <stop offset="100%" stop-color="#2F81F7" stop-opacity="0.03" />
    </linearGradient>
  </defs>
  <style>
    .title { fill: #1f2328; font: 600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .subtitle, .row, .axis { fill: #57606a; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .subtitle { font-size: 11px; }
    .axis { font-size: 9px; }
    .caption { fill: #57606a; font: 10px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .icon { fill: none; stroke: #57606a; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
    .grid { stroke: #d0d7de; stroke-width: 1; stroke-dasharray: 3 3; }
    .trend { fill: none; stroke: #2F81F7; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    @media (prefers-color-scheme: dark) {
      .title { fill: #e6edf3; }
      .subtitle, .row, .axis, .caption { fill: #8b949e; }
      .icon { stroke: #8b949e; }
      .grid { stroke: #30363d; }
    }
  </style>
  <text class="title" x="24" y="46">${escapeXml(title)}</text>
  <text class="subtitle" x="24" y="66">${escapeXml(subtitle)}</text>
${rowMarkup}
  <text class="caption" x="${x1}" y="84" text-anchor="end">monthly commits</text>
${grid}
  <path d="${area}" fill="url(#area)" />
  <path class="trend" d="${line}" />
  <text class="axis" x="${x0 - 8}" y="${yTop + 4}" text-anchor="end">${integer.format(max)}</text>
  <text class="axis" x="${x0 - 8}" y="${yBottom + 4}" text-anchor="end">0</text>
${yearLabels}
</svg>
`;
}

async function main() {
  const owners = resolveOwners();
  const repos = await collectRepos(owners);
  const user = await getJson(`/users/${PRIMARY_OWNER}`);

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const createdYear = user?.created_at ? new Date(user.created_at).getUTCFullYear() : currentYear;
  // Cover the last `YEARS` calendar years, never before the account was created.
  const startYear = Math.max(Math.min(createdYear, currentYear), currentYear - YEARS + 1);
  const start = new Date(Date.UTC(startYear, 0, 1));
  const since = start.toISOString();

  const months = buildMonths(start, now);
  const byMonth = new Map(months.map((month) => [month.key, month]));

  for (const repo of repos) {
    for (const commit of await commitsSince(repo, since)) {
      if (!isOwnCommit(commit)) continue;
      const date = new Date(commit.commit?.author?.date ?? commit.commit?.committer?.date);
      if (Number.isNaN(date.getTime()) || date < start) continue;
      const bucket = byMonth.get(monthKey(date));
      if (bucket) bucket.count += 1;
    }
  }

  const currentYearCommits = months
    .filter((month) => month.year === currentYear)
    .reduce((sum, month) => sum + month.count, 0);
  const yearsJoined = user?.created_at
    ? Math.floor(
        (now.getTime() - new Date(user.created_at).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
      )
    : null;
  const name = user?.name || PRIMARY_OWNER;

  const rows = [
    { icon: 'commit', text: `${integer.format(currentYearCommits)} commits in ${currentYear}` },
    { icon: 'repo', text: `${repos.length} public repos` },
    {
      icon: 'clock',
      text: yearsJoined === null ? 'Joined GitHub' : `Joined GitHub ${yearsJoined} years ago`,
    },
  ];

  const max = Math.max(1, ...months.map((month) => month.count));

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(
    OUTPUT,
    renderSvg({
      title: `${name} (${PRIMARY_OWNER})`,
      subtitle: owners.join(' · '),
      rows,
      months,
      max,
    }),
    'utf8',
  );

  console.log(`Wrote ${OUTPUT}`);
  console.log(`Repos: ${repos.length} (${owners.join(', ')})`);
  console.log(`Months: ${months.length}, max: ${max}, ${currentYear}: ${currentYearCommits}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
