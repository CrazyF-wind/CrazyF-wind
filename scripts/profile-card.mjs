#!/usr/bin/env node
// Render a profile summary card that aggregates the personal account and the
// partner organizations: repositories, commits by the profile owner, and a
// daily commit trend over the last month.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRIMARY_OWNER,
  collectRepos,
  getJson,
  isOwnCommit,
  resolveOwners,
} from './lib/github.mjs';

const OUTPUT = resolve('assets/profile-card.svg');
const DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
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

function dateKey(date) {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

function buildDays(startTime, count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startTime + index * DAY);
    return { key: dateKey(date), date, count: 0 };
  });
}

const ICONS = {
  commit: '<circle cx="8" cy="8" r="3.5" /><path d="M0 8h4.5M11.5 8H16" />',
  repo: '<rect x="1.5" y="2" width="13" height="12" rx="2" /><path d="M5 2v12" />',
  clock: '<circle cx="8" cy="8" r="6.5" /><path d="M8 4.5V8l2.5 1.5" />',
};

// Picks an integer step and rounded top so the right-hand axis carries a
// handful of readable ticks regardless of how busy the busiest day is.
function niceScale(max, targetTicks = 5) {
  const rawStep = max / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)));
  const step = Math.max(
    1,
    [1, 2, 5, 10]
      .map((factor) => factor * magnitude)
      .find((value) => value >= rawStep) ?? magnitude * 10,
  );
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = 0; value <= top + 1e-9; value += step) ticks.push(Math.round(value));
  return { top, ticks };
}

// Monotone cubic interpolation (Fritsch–Carlson): smooth like the reference
// chart, without overshooting above a peak or dipping below the baseline.
function smoothPath(points) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  const slopes = points.slice(1).map((point, index) => {
    const previous = points[index];
    return (point.y - previous.y) / (point.x - previous.x);
  });
  const tangents = new Array(points.length);
  tangents[0] = slopes[0];
  tangents[points.length - 1] = slopes[slopes.length - 1];
  for (let index = 1; index < points.length - 1; index += 1) {
    tangents[index] =
      slopes[index - 1] * slopes[index] <= 0
        ? 0
        : (slopes[index - 1] + slopes[index]) / 2;
  }
  for (let index = 0; index < slopes.length; index += 1) {
    if (slopes[index] === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const alpha = tangents[index] / slopes[index];
    const beta = tangents[index + 1] / slopes[index];
    const squared = alpha * alpha + beta * beta;
    if (squared > 9) {
      const scale = 3 / Math.sqrt(squared);
      tangents[index] = scale * alpha * slopes[index];
      tangents[index + 1] = scale * beta * slopes[index];
    }
  }

  let path = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const handle = (to.x - from.x) / 3;
    path +=
      ` C${(from.x + handle).toFixed(1)} ${(from.y + tangents[index] * handle).toFixed(1)}` +
      ` ${(to.x - handle).toFixed(1)} ${(to.y - tangents[index + 1] * handle).toFixed(1)}` +
      ` ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
  }
  return path;
}

function dayLabel(day) {
  return `${String(day.date.getUTCMonth() + 1).padStart(2, '0')}/${String(
    day.date.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function renderSvg({ title, subtitle, caption, rows, days, max }) {
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
  const { top, ticks } = niceScale(max);
  const step = days.length > 1 ? (x1 - x0) / (days.length - 1) : 0;
  const points = days.map((day, index) => ({
    x: x0 + step * index,
    y: yBottom - (day.count / top) * (yBottom - yTop),
    day,
  }));

  const line = smoothPath(points);
  const area = `${line} L${x1.toFixed(1)} ${yBottom} L${x0.toFixed(1)} ${yBottom} Z`;

  const grid = ticks
    .filter((value) => value > 0 && value < top)
    .map((value) => {
      const y = yBottom - (value / top) * (yBottom - yTop);
      return `  <line class="grid" x1="${x0}" y1="${y.toFixed(1)}" x2="${x1}" y2="${y.toFixed(1)}" />`;
    })
    .join('\n');

  const axisLines = [
    `  <line class="axis-line" x1="${x0}" y1="${yBottom}" x2="${x1}" y2="${yBottom}" />`,
    `  <line class="axis-line" x1="${x1}" y1="${yBottom}" x2="${x1}" y2="${yTop}" />`,
  ].join('\n');

  const tickMarks = ticks
    .map((value) => {
      const y = yBottom - (value / top) * (yBottom - yTop);
      return [
        `  <line class="axis-line" x1="${x1}" y1="${y.toFixed(1)}" x2="${x1 + 3}" y2="${y.toFixed(1)}" />`,
        `  <text class="axis-label" x="${x1 + 6}" y="${(y + 3).toFixed(1)}">${integer.format(value)}</text>`,
      ].join('\n');
    })
    .join('\n');

  const dayLabels = points
    .filter((_, index) => index % 7 === 0 && index <= points.length - 5)
    .concat(points[points.length - 1])
    .map(
      (point) =>
        `  <text class="axis-label" x="${point.x.toFixed(1)}" y="${yBottom + 18}" text-anchor="middle">${dayLabel(point.day)}</text>`,
    )
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)} profile summary">
  <defs>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2F81F7" stop-opacity="0.55" />
      <stop offset="100%" stop-color="#2F81F7" stop-opacity="0.05" />
    </linearGradient>
  </defs>
  <style>
    .title { fill: #1f2328; font: 600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .subtitle, .row { fill: #57606a; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .subtitle { font-size: 11px; }
    .axis-label { fill: #57606a; font: 9px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .caption { fill: #57606a; font: 10px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .icon { fill: none; stroke: #57606a; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
    .grid { stroke: #d0d7de; stroke-width: 1; stroke-dasharray: 3 3; }
    .axis-line { stroke: #d0d7de; stroke-width: 1; }
    .trend { fill: none; stroke: #2F81F7; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    @media (prefers-color-scheme: dark) {
      .title { fill: #e6edf3; }
      .subtitle, .row, .axis-label, .caption { fill: #8b949e; }
      .icon { stroke: #8b949e; }
      .grid, .axis-line { stroke: #30363d; }
    }
  </style>
  <text class="title" x="24" y="46">${escapeXml(title)}</text>
  <text class="subtitle" x="24" y="66">${escapeXml(subtitle)}</text>
${rowMarkup}
  <text class="caption" x="${x1}" y="84" text-anchor="end">${escapeXml(caption)}</text>
${grid}
  <path d="${area}" fill="url(#area)" />
  <path class="trend" d="${line}" />
${axisLines}
${tickMarks}
${dayLabels}
</svg>
`;
}

async function main() {
  const owners = resolveOwners();
  const repos = await collectRepos(owners);
  const user = await getJson(`/users/${PRIMARY_OWNER}`);

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const todayStart = Date.UTC(currentYear, now.getUTCMonth(), now.getUTCDate());
  const windowStart = todayStart - (DAYS - 1) * DAY;
  const yearStart = Date.UTC(currentYear, 0, 1);
  // Fetch enough history for both the chart window and the current-year total.
  const since = new Date(Math.min(windowStart, yearStart)).toISOString();

  const days = buildDays(windowStart, DAYS);
  const byDay = new Map(days.map((day) => [day.key, day]));

  let currentYearCommits = 0;
  for (const repo of repos) {
    for (const commit of await commitsSince(repo, since)) {
      if (!isOwnCommit(commit)) continue;
      const date = new Date(commit.commit?.author?.date ?? commit.commit?.committer?.date);
      if (Number.isNaN(date.getTime())) continue;
      if (date.getTime() >= yearStart) currentYearCommits += 1;
      const bucket = byDay.get(dateKey(date));
      if (bucket) bucket.count += 1;
    }
  }
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

  const max = Math.max(1, ...days.map((day) => day.count));
  const caption = `daily commits · last ${DAYS} days`;

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(
    OUTPUT,
    renderSvg({
      title: `${name} (${PRIMARY_OWNER})`,
      subtitle: owners.join(' · '),
      caption,
      rows,
      days,
      max,
    }),
    'utf8',
  );

  console.log(`Wrote ${OUTPUT}`);
  console.log(`Repos: ${repos.length} (${owners.join(', ')})`);
  console.log(`Days: ${days.length}, max: ${max}, ${currentYear}: ${currentYearCommits}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
