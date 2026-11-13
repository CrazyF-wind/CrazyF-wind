import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSvg } from './contributions.mjs';

const rows = [
  { owner: 'CrazyF-wind', commits: 128, pulls: 3, issues: 1 },
  { owner: 'tavorit-dev', commits: 52, pulls: 2, issues: 0 },
  { owner: 'Open-Multiverse', commits: 18, pulls: 1, issues: 0 },
  { owner: 'open-wuxu', commits: 12, pulls: 0, issues: 1 },
];

test('renders every owner in the configured order', () => {
  const svg = renderSvg({ rows, repoCount: 12 });
  const positions = rows.map((row) => svg.indexOf(`>${row.owner}<`));
  assert.ok(positions.every((position) => position !== -1), 'every owner is rendered');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("prints each owner's own commit, pull request and issue counts", () => {
  const svg = renderSvg({ rows, repoCount: 12 });
  for (const row of rows) {
    const start = svg.indexOf(`>${row.owner}<`);
    const nextOwner = rows
      .map((candidate) => svg.indexOf(`>${candidate.owner}<`))
      .filter((position) => position > start)
      .sort((a, b) => a - b)[0];
    const block = svg.slice(start, nextOwner ?? svg.length);
    assert.match(block, new RegExp(`>${row.commits}<`), `${row.owner} commits`);
    assert.match(block, new RegExp(`>${row.pulls}<`), `${row.owner} pull requests`);
    assert.match(block, new RegExp(`>${row.issues}<`), `${row.owner} issues`);
  }
});

test('adds a total row that sums every owner', () => {
  const svg = renderSvg({ rows, repoCount: 12 });
  assert.match(svg, />Total</);
  assert.match(svg, />210</);
  assert.match(svg, />6</);
  assert.match(svg, />2</);
});

test('escapes XML characters in owner names', () => {
  const svg = renderSvg({
    rows: [{ owner: 'A&B <Labs>', commits: 1, pulls: 0, issues: 0 }],
    repoCount: 1,
  });
  assert.match(svg, />A&amp;B &lt;Labs&gt;</);
  assert.doesNotMatch(svg, />A&B <Labs></);
});

test('mentions the public repository count in the subtitle', () => {
  const svg = renderSvg({ rows, repoCount: 12 });
  assert.match(svg, />[^<]*12 public repos[^<]*</);
});

test('labels the totals as all-time so they are not read as the current year', () => {
  const svg = renderSvg({ rows, repoCount: 12 });
  assert.match(svg, />[^<]*all time[^<]*</);
});
