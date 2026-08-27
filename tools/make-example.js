#!/usr/bin/env node
/**
 * Dev-only: regenerate sample-data/example.json with dates relative to today,
 * so the demo board shows believable card ages instead of "412d" everywhere.
 * Run: node tools/make-example.js
 *
 * Forefront itself never runs this. Node is not needed to use the app.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { FF, root } = require('./_load.js');
const M = FF.model;

const NOW = new Date();
function daysAgo(n, hour = 10, minute = 0) {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n, hour, minute);
  return d.toISOString();
}

// title, lane, age in days
const SEED = [
  ['Ask Mike whether contractor extensions are in Q4 funding', 'inbox', 1],
  ['Follow up on the vendor SOC 2 report',                     'inbox', 0],
  ['Something Dana raised about the offsite agenda',           'inbox', 3],

  ['Complete team financial analysis',        'inprogress', 9],
  ['Finish security strategy draft',          'inprogress', 22],
  ['Review architecture proposal',            'inprogress', 12],

  ['Review staffing proposal',                'management', 6],
  ['Prepare for the leadership review',       'management', 4],
  ['Clean up Jira hygiene across the team',   'management', 14],
  ['Review the open issue log',               'management', 8],
  ['Review vendor strategy',                  'management', 19],

  ['Write the FY27 roadmap',                  'projects', 11],
  ['Write the team mission statement',        'projects', 26],
  ['Build the platform operating model',      'projects', 5],

  ['Email Amy the revised headcount numbers', 'justdoit', 2],
  ['Send Peter the link to the deck',         'justdoit', 1],
  ['Approve the expense report',              'justdoit', 3],
  ['Reply to Dana about the offsite date',    'justdoit', 0],
  ['Send Priya the onboarding doc',           'justdoit', 5],
  ['Ask Facilities about the move date',      'justdoit', 7],
];

// title, lane it came from, days ago created, days ago completed
const COMPLETED = [
  ['Draft the quarterly board summary', 'projects',   14, 1],
  ['Give Sam feedback on the design doc','management', 8, 2],
  ['Approve the contractor renewal',     'justdoit',   6, 3],
  ['Publish the on-call rotation',       'management', 12, 9], // older than the
                                                               // Done window: in
                                                               // history, off the board
];

const data = M.createEmptyData();
data.meta.createdAt = daysAgo(40);

// Build oldest-first so that addCard's "newest to the top" leaves each lane in a
// sensible order without any hand-set indices.
SEED.slice().sort((a, b) => b[2] - a[2]).forEach(([title, lane, age]) => {
  const card = M.addCard(data, title, lane);
  card.createdAt = daysAgo(age, 9, 15);
  card.updatedAt = card.createdAt;
});

data.cards.find(c => c.title.startsWith('Review vendor strategy')).notes =
  'Renewal window opens in Q1. Worth deciding whether we keep both vendors.';
data.cards.find(c => c.title.startsWith('Finish security strategy')).notes =
  'Sections 1-3 drafted. Still need the identity roadmap and the funding ask.';

COMPLETED.forEach(([title, lane, created, completed]) => {
  const card = M.addCard(data, title, lane);
  card.createdAt = daysAgo(created, 9, 15);
  M.completeCard(data, card.id);
  card.completedAt = daysAgo(completed, 16, 30);
  card.updatedAt = card.completedAt;
});
// Re-sort Done newest-first now that the timestamps have been backdated.
M.laneCards(data, 'done')
  .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
  .forEach((c, i) => { c.order = i; });

const dropped = M.addCard(data, 'Look into the conference CFP', 'projects');
dropped.createdAt = daysAgo(31, 9, 15);
M.discardCard(data, dropped.id);
M.findCard(data, dropped.id).discardedAt = daysAgo(4, 17, 0);

// Two weeks of review history, showing a completed week and a skipped one.
const lastMonday = M.weekStart(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 7));
const priorMonday = M.weekStart(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 14));
data.weeklyReviews = [
  {
    weekOf: M.dateKey(priorMonday),
    status: 'skipped',
    completedAt: new Date(priorMonday.getFullYear(), priorMonday.getMonth(), priorMonday.getDate(), 8, 5).toISOString(),
    commitmentIds: [],
    deferrals: [],
    note: ''
  },
  {
    weekOf: M.dateKey(lastMonday),
    status: 'completed',
    completedAt: new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate(), 9, 12).toISOString(),
    commitmentIds: M.commitments(data).map(c => c.id),
    deferrals: [new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate(), 8, 2).toISOString()],
    note: ''
  }
];

data.meta.updatedAt = new Date().toISOString();

const out = path.join(root, 'sample-data', 'example.json');
fs.writeFileSync(out, M.serialize(data) + '\n');

const check = M.validateData(JSON.parse(fs.readFileSync(out, 'utf8')));
if (!check.ok) { console.error('Generated example is invalid:', check.errors); process.exit(1); }
console.log(`Wrote ${path.relative(root, out)} — ${data.cards.length} cards, ${data.weeklyReviews.length} reviews`);
