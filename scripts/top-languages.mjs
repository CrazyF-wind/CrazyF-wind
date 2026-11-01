#!/usr/bin/env node
// Aggregate language bytes from personal repos and partner organizations,
// then render a self-contained SVG card for the profile README.
//
// Usage:
//   GITHUB_TOKEN=... node scripts/top-languages.mjs
//
// OWNERS can be overridden with a comma-separated list.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OWNERS = (process.env.OWNERS ?? 'CrazyF-wind,tavorit-dev,Open-Multiverse')
  .split(',')
  .map((owner) => owner.trim())
  .filter(Boolean);
const OUTPUT = resolve('assets/top-languages.svg');
const TOP_N = 8;
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN;

// Linguist colours for the languages that actually show up in these repos.
const LANGUAGE_COLORS = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Go: '#00ADD8',
  Rust: '#dea584',
  Python: '#3572A5',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Markdown: '#083fa1',
  Shell: '#89e051',
  Makefile: '#427819',
  Dockerfile: '#384d54',
  'C': '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Java: '#b07219',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  Dart: '#00B4AB',
  Lua: '#000080',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Zig: '#ec915c',
  GLSL: '#5686a5',
  WGSL: '#1a5e9a',
  Nix: '#7e7eff',
  Elixir: '#6e4a7e',
  Haskell: '#5e5086',
  Scala: '#c22d40',
  OCaml: '#ef7a08',
  TeX: '#3D6117',
  PowerShell: '#012456',
  Batchfile: '#C1F12E',
};

const FALLBACK_COLORS = ['#8250df', '#1a7f37', '#bc4c00', '#0969da', '#cf222e', '#6639ba'];

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'top-languages-card',
};
if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

async function getJson(path) {
  const response = await fetch(`${API}${path}`, { headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
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

function colorFor(language, index) {
  return LANGUAGE_COLORS[language] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatPercent(percent) {
  const fixed = percent >= 10 ? percent.toFixed(0) : percent.toFixed(1);
  return `${fixed.replace(/\.0$/, '')}%`;
}

function renderSvg(languages, { repos, owners }) {
  const width = 495;
  const rowHeight = 26;
  const firstRowY = 78;
  const height = firstRowY + languages.length * rowHeight + 14;

  const total = languages.reduce((sum, entry) => sum + entry.bytes, 0);
  const subtitle = `${owners.join(' · ')} · ${repos} repos`;

  const rows = languages
    .map((entry, index) => {
      const y = firstRowY + index * rowHeight;
      const percent = (entry.bytes / total) * 100;
      const barWidth = Math.max(2, Math.round((percent / 100) * 260));
      return [
        `  <text class="label" x="20" y="${y + 8}">${escapeXml(entry.name)}</text>`,
        `  <rect class="track" x="150" y="${y}" width="260" height="8" rx="4" />`,
        `  <rect x="150" y="${y}" width="${barWidth}" height="8" rx="4" fill="${entry.color}" />`,
        `  <text class="pct" x="475" y="${y + 8}" text-anchor="end">${formatPercent(percent)}</text>`,
      ].join('\n');
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Most used languages across ${escapeXml(owners.join(', '))}">
  <style>
    .title { fill: #1f2328; font: 600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .subtitle { fill: #57606a; font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .label, .pct { fill: #57606a; font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .track { fill: #d0d7de; }
    @media (prefers-color-scheme: dark) {
      .title { fill: #e6edf3; }
      .subtitle, .label, .pct { fill: #8b949e; }
      .track { fill: #30363d; }
    }
  </style>
  <text class="title" x="20" y="30">Most Used Languages</text>
  <text class="subtitle" x="20" y="48">${escapeXml(subtitle)}</text>
${rows}
</svg>
`;
}

async function main() {
  const seen = new Set();
  const repos = [];

  for (const owner of OWNERS) {
    const ownerRepos = await listRepos(owner);
    for (const repo of ownerRepos) {
      if (repo.fork || repo.name === '.github' || seen.has(repo.full_name)) continue;
      seen.add(repo.full_name);
      repos.push(repo);
    }
  }

  const totals = new Map();
  for (const repo of repos) {
    const languages = await getJson(`/repos/${repo.full_name}/languages`);
    if (!languages) continue;
    for (const [language, bytes] of Object.entries(languages)) {
      totals.set(language, (totals.get(language) ?? 0) + bytes);
    }
  }

  if (totals.size === 0) throw new Error('No language data found.');

  const sorted = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes], index) => ({ name, bytes, color: colorFor(name, index) }));

  const top = sorted.slice(0, TOP_N);
  const restBytes = sorted.slice(TOP_N).reduce((sum, entry) => sum + entry.bytes, 0);
  if (restBytes > 0) {
    top.push({ name: 'Other', bytes: restBytes, color: '#8b949e' });
  }

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, renderSvg(top, { repos: repos.length, owners: OWNERS }), 'utf8');

  console.log(`Wrote ${OUTPUT}`);
  console.log(`Repos: ${repos.length} (${OWNERS.join(', ')})`);
  for (const entry of top) {
    const percent = ((entry.bytes / sorted.reduce((sum, item) => sum + item.bytes, 0)) * 100).toFixed(1);
    console.log(`  ${entry.name.padEnd(16)} ${percent.padStart(5)}%  ${entry.bytes} bytes`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
