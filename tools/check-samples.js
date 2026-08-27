#!/usr/bin/env node
/**
 * Dev-only: verify the shipped sample files are valid Forefront datasets, and
 * that sample-data/empty.json matches the empty dataset the app builds in code.
 *
 * They have to be kept in step by hand because a page loaded from file:// cannot
 * fetch() an adjacent JSON file, so the app can never read empty.json at
 * runtime — it constructs the same shape itself. This check is what stops the
 * two drifting apart. Run: node tools/check-samples.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { FF, root } = require('./_load.js');
const M = FF.model;

let fail = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok    ' + name);
  else { fail++; console.error('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

function shape(obj) {
  if (Array.isArray(obj)) return 'array';
  if (obj === null || typeof obj !== 'object') return typeof obj;
  return Object.keys(obj).sort().map(k => k + ':' + shape(obj[k])).join(',');
}

for (const file of ['empty.json', 'example.json']) {
  const p = path.join(root, 'sample-data', file);
  console.log('\n' + file);
  if (!fs.existsSync(p)) { check('exists', false); continue; }

  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { check('parses as JSON', false, e.message); continue; }

  check('parses as JSON', true);
  const res = M.validateData(JSON.parse(JSON.stringify(parsed)));
  check('validates', res.ok, (res.errors || []).join('; '));
  check('imports with no warnings', res.ok && res.warnings.length === 0, (res.warnings || []).join('; '));
  check('imports with nothing rejected', res.ok && res.rejected.length === 0, (res.rejected || []).join('; '));
  check('declares the current schema version', parsed.schemaVersion === FF.C.SCHEMA_VERSION);
  check('identifies itself as Forefront', parsed.app === FF.C.APP_NAME);
}

console.log('\nempty.json vs createEmptyData()');
const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'sample-data', 'empty.json'), 'utf8'));
const inCode = M.createEmptyData();
check('same top-level keys', shape(Object.keys(onDisk).sort()) === shape(Object.keys(inCode).sort()),
      'disk: ' + Object.keys(onDisk).sort() + ' / code: ' + Object.keys(inCode).sort());
check('same meta keys', String(Object.keys(onDisk.meta).sort()) === String(Object.keys(inCode.meta).sort()));
check('both start with no cards', onDisk.cards.length === 0 && inCode.cards.length === 0);
check('both start with no reviews', onDisk.weeklyReviews.length === 0 && inCode.weeklyReviews.length === 0);
check('same schemaVersion', onDisk.schemaVersion === inCode.schemaVersion);

console.log('\nexample.json is a useful demo');
const ex = JSON.parse(fs.readFileSync(path.join(root, 'sample-data', 'example.json'), 'utf8'));
const exData = M.validateData(ex).data;
const now = new Date();
check('has inbox items to triage', M.laneCards(exData, 'inbox', now).length > 0);
check('has ~3 commitments', M.commitments(exData).length === FF.C.FOCUS_COMMITMENTS);
check('every working lane is populated',
      ['management','projects','justdoit'].every(l => M.laneCards(exData, l, now).length > 0));
check('shows recent completions', M.laneCards(exData, 'done', now).length > 0,
      'example.json has aged past the Done window — rerun: node tools/make-example.js');
check('keeps a completion older than the Done window',
      M.completedCards(exData).length > M.laneCards(exData, 'done', now).length);
check('includes a discarded card', exData.cards.some(c => c.discardedAt));
check('includes review history', exData.weeklyReviews.length >= 2);
check('includes both a completed and a skipped review',
      exData.weeklyReviews.some(r => r.status === 'completed') &&
      exData.weeklyReviews.some(r => r.status === 'skipped'));
const ages = M.laneCards(exData, 'management', now).map(c => M.ageDays(c, now));
check('has an aging card worth noticing (>14d)', ages.some(a => a > 14), 'ages: ' + ages);

console.log(fail === 0 ? '\n  ✓ sample data OK\n' : `\n  ${fail} FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
