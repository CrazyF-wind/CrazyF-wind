#!/usr/bin/env node
// Render a profile summary card that aggregates the personal account and the
// partner organizations: repositories, calendar-year commits, and a yearly
// commit bar chart.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { collectRepos, getJson, resolveOwners } from './lib/github.mjs';

const OUTPUT = resolve('assets/profile-card.svg');
const PRIMARY = process.env.PRIMARY_OWNER || 'CrazyF-wind';
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

const ICONS = {
  commit: '<circle cx="8" cy="8" r="3.5" /><path d="M0 8h4.5M11.5 8H16" />',
  repo: '<rect x="1.5" y="2" width="13" height="12" rx="2" /><path d="M5 2v12" />',
  clock: '<circle cx="8" cy="8" r="6.5" /><path d="M8 4.5V8l2.5 1.5" />',
};

function renderSvg({ title, subtitle, rows, years, max }) {
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
  const slot = years.length > 0 ? (x1 - x0) / years.length : 0;
  const barWidth = Math.min(18, slot * 0.55);
  const labelStep = years.length > 15 ? 2 : 1;

  const bars = years
    .map((year, index) => {
      const barHeight = (year.count / max) * (yBottom - yTop);
      if (barHeight <= 0) return '';
      const x = x0 + slot * index + (slot - barWidth) / 2;
      return `  <rect class="bar" x="${x.toFixed(1)}" y="${(yBottom - barHeight).toFixed(
        1,
      )}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2" />`;
    })
    .filter(Boolean)
    .join('\n');

  const grid = [0, 0.5, 1]
    .map((ratio) => {
      const y = yBottom - ratio * (yBottom - yTop);
      return `  <line class="grid" x1="${x0}" y1="${y.toFixed(1)}" x2="${x1}" y2="${y.toFixed(1)}" />`;
    })
    .join('\n');

  const xLabels = years
    .map((year, index) =>
      index % labelStep === 0 || index === years.length - 1
        ? `  <text class="axis" x="${(x0 + slot * (index + 0.5)).toFixed(
            1,
          )}" y="${yBottom + 18}" text-anchor="middle">${year.label}</text>`
        : '',
    )
    .filter(Boolean)
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)} profile summary">
  <style>
    .title { fill: #1f2328; font: 600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .subtitle, .row, .axis { fill: #57606a; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .subtitle { font-size: 11px; }
    .axis { font-size: 9px; }
    .caption { fill: #57606a; font: 10px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .icon { fill: none; stroke: #57606a; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
    .grid { stroke: #d0d7de; stroke-width: 1; stroke-dasharray: 3 3; }
    .bar { fill: #2F81F7; }
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
  <text class="caption" x="${x1}" y="84" text-anchor="end">commits per year</text>
${grid}
${bars}
  <text class="axis" x="${x0 - 8}" y="${yTop + 4}" text-anchor="end">${integer.format(max)}</text>
  <text class="axis" x="${x0 - 8}" y="${yBottom + 4}" text-anchor="end">0</text>
${xLabels}
</svg>
`;
}

async function main() {
  const owners = resolveOwners();
  const repos = await collectRepos(owners);
  const user = await getJson(`/users/${PRIMARY}`);

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const createdYear = user?.created_at
    ? new Date(user.created_at).getUTCFullYear()
    : currentYear;
  const startYear = Math.min(createdYear, currentYear);
  const since = new Date(Date.UTC(startYear, 0, 1)).toISOString();

  const years = [];
  for (let year = startYear; year <= currentYear; year += 1) {
    years.push({ label: String(year), count: 0 });
  }
  const byYear = new Map(years.map((year) => [year.label, year]));

  for (const repo of repos) {
    for (const commit of await commitsSince(repo, since)) {
      // Count only commits attributed to the profile owner's GitHub account.
      if (commit.author?.login?.toLowerCase() !== PRIMARY.toLowerCase()) continue;
      const date = new Date(commit.commit?.author?.date ?? commit.commit?.committer?.date);
      if (Number.isNaN(date.getTime())) continue;
      const bucket = byYear.get(String(date.getUTCFullYear()));
      if (bucket) bucket.count += 1;
    }
  }

  const yearTotal = years.reduce((sum, year) => sum + year.count, 0);
  const currentYearCommits = byYear.get(String(currentYear))?.count ?? 0;
  const yearsJoined = user?.created_at
    ? Math.floor(
        (now.getTime() - new Date(user.created_at).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
      )
    : null;
  const name = user?.name || PRIMARY;

  const rows = [
    {
      icon: 'commit',
      text: `${integer.format(currentYearCommits)} commits in ${currentYear} · ${integer.format(
        yearTotal,
      )} total`,
    },
    { icon: 'repo', text: `${repos.length} public repos` },
    {
      icon: 'clock',
      text: yearsJoined === null ? 'Joined GitHub' : `Joined GitHub ${yearsJoined} years ago`,
    },
  ];

  const max = Math.max(1, ...years.map((year) => year.count));

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(
    OUTPUT,
    renderSvg({
      title: `${name} (${PRIMARY})`,
      subtitle: owners.join(' · '),
      rows,
      years,
      max,
    }),
    'utf8',
  );

  console.log(`Wrote ${OUTPUT}`);
  console.log(`Repos: ${repos.length} (${owners.join(', ')})`);
  console.log(years.map((year) => `${year.label}=${year.count}`).join(' '));
  console.log(`Total: ${yearTotal}, ${currentYear}: ${currentYearCommits}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
