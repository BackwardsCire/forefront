#!/usr/bin/env node
// Dev-only self-test for the Forefront data model. Run: node tools/selftest.js
'use strict';
const { FF } = require('./_load.js');
const M = FF.model;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL: ' + name + (extra ? '\n        ' + extra : '')); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
     'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// ---- empty dataset ----
const d = M.createEmptyData();
eq('empty: schemaVersion', d.schemaVersion, 1);
eq('empty: app', d.app, 'Forefront');
eq('empty: cards', d.cards, []);
eq('empty: reviews', d.weeklyReviews, []);
eq('empty: key set', Object.keys(d).sort(), ['app','cards','meta','schemaVersion','weeklyReviews']);

// ---- capture goes to top of inbox ----
const a = M.addCard(d, 'first');
const b = M.addCard(d, 'second');
const c = M.addCard(d, 'third');
eq('capture: newest first', M.laneCards(d, 'inbox').map(x => x.title), ['third','second','first']);
eq('capture: dense order', M.laneCards(d, 'inbox').map(x => x.order), [0,1,2]);

// ---- move within lane ----
M.moveCard(d, a.id, 'inbox', 0);
eq('move: to top', M.laneCards(d, 'inbox').map(x => x.title), ['first','third','second']);
M.moveCard(d, a.id, 'inbox', 2);
eq('move: to bottom', M.laneCards(d, 'inbox').map(x => x.title), ['third','second','first']);
M.moveCard(d, a.id, 'inbox', 1);
eq('move: to middle', M.laneCards(d, 'inbox').map(x => x.title), ['third','first','second']);

// ---- move across lanes renumbers both ----
M.moveCard(d, b.id, 'projects', 0);
eq('move: source renumbered', M.laneCards(d, 'inbox').map(x => x.order), [0,1]);
eq('move: target has card', M.laneCards(d, 'projects').map(x => x.title), ['second']);

// ---- nudge ----
ok('nudge: up at top is a no-op', M.nudgeCard(d, M.laneCards(d,'inbox')[0].id, -1) === false);
ok('nudge: down works', M.nudgeCard(d, M.laneCards(d,'inbox')[0].id, 1) === true);
eq('nudge: swapped', M.laneCards(d, 'inbox').map(x => x.title), ['first','third']);

// ---- completion ----
M.completeCard(d, c.id);
const done = M.findCard(d, c.id);
ok('complete: lane', done.lane === 'done');
ok('complete: timestamp', !!done.completedAt);
eq('complete: sourceLane recorded', done.sourceLane, 'inbox');
eq('complete: gone from inbox', M.laneCards(d,'inbox').map(x=>x.title), ['first']);
eq('complete: visible in done', M.laneCards(d,'done').map(x=>x.title), ['third']);

// ---- un-complete by dragging out ----
M.moveCard(d, c.id, 'management', 0);
ok('uncomplete: completedAt cleared', M.findCard(d,c.id).completedAt === null);
ok('uncomplete: sourceLane cleared', M.findCard(d,c.id).sourceLane === null);
M.completeCard(d, c.id);

// ---- done visibility window ----
const old = M.findCard(d, c.id);
old.completedAt = new Date(Date.now() - 5*86400000).toISOString();
eq('done: 5d old hidden from lane', M.laneCards(d,'done').length, 0);
eq('done: still in history', M.completedCards(d).length, 1);
eq('done: still in cards array', d.cards.filter(x=>x.id===c.id).length, 1);

// ---- discard ----
const disc = M.addCard(d, 'never mind');
M.discardCard(d, disc.id);
eq('discard: leaves lanes', M.laneCards(d,'inbox').map(x=>x.title), ['first']);
ok('discard: timestamp', !!M.findCard(d, disc.id).discardedAt);
ok('discard: preserved in JSON', !!M.findCard(d, disc.id));
eq('discard: sourceLane recorded', M.findCard(d, disc.id).sourceLane, 'inbox');
M.restoreCard(d, disc.id);
eq('restore: back to its lane', M.laneCards(d,'inbox').map(x=>x.title), ['never mind','first']);

// ---- restoring must not rewrite history ----
const h = M.createEmptyData();
const finished = M.addCard(h, 'finished then tidied away', 'management');
M.completeCard(h, finished.id);
const stamp = M.findCard(h, finished.id).completedAt;
M.discardCard(h, finished.id);
eq('discard: a completed card leaves Done', M.laneCards(h,'done').length, 0);
M.restoreCard(h, finished.id);
const back = M.findCard(h, finished.id);
eq('restore: a completed card goes back to Done', back.lane, 'done');
eq('restore: its completion time is intact', back.completedAt, stamp);
eq('restore: it is still counted as completed work', M.completedCards(h).length, 1);
eq('restore: and it is visible in Done again', M.laneCards(h,'done').length, 1);

const openCard = M.addCard(h, 'never finished', 'projects');
M.discardCard(h, openCard.id);
M.restoreCard(h, openCard.id);
eq('restore: an uncompleted card returns to its own lane', M.findCard(h, openCard.id).lane, 'projects');
ok('restore: and is still not completed', M.findCard(h, openCard.id).completedAt === null);

// A sourceLane of 'done' is meaningless and must never be restored into.
const weird = M.addCard(h, 'weird sourceLane', 'inbox');
M.findCard(h, weird.id).sourceLane = 'done';
eq('restore: a sourceLane of done falls back to inbox', M.restoreLaneFor(M.findCard(h, weird.id)), 'inbox');

// ---- unknown fields, including __proto__ ----
const proto = M.validateData({
  schemaVersion: 1, meta: {}, weeklyReviews: [],
  cards: [JSON.parse('{"id":"p","title":"polluted","lane":"inbox","order":0,"createdAt":"2026-01-01T00:00:00Z","__proto__":{"polluted":true},"keep":"this"}')]
});
ok('validate: accepts a card carrying __proto__', proto.ok);
const pc = proto.data.cards[0];
eq('validate: ordinary unknown fields still survive', pc.keep, 'this');
ok('validate: __proto__ is kept as a real own field', Object.prototype.hasOwnProperty.call(pc, '__proto__'));
ok('validate: and did NOT become the object prototype', Object.getPrototypeOf(pc) === Object.prototype);
ok('validate: nothing leaked onto Object.prototype', ({}).polluted === undefined);
ok('validate: it round-trips through JSON', JSON.stringify(pc).indexOf('__proto__') !== -1);

// ---- age uses calendar days ----
const card = M.addCard(d, 'aged');
card.createdAt = new Date(2026,0,1,23,30).toISOString();
eq('age: same day', M.ageLabel(card, new Date(2026,0,1,23,45)), 'today');
eq('age: next morning is 1d', M.ageLabel(card, new Date(2026,0,2,7,0)), '1d');
eq('age: 12 days', M.ageLabel(card, new Date(2026,0,13,7,0)), '12d');

// ---- weekOf lands on Monday ----
eq('weekOf: Monday',    M.weekOf(new Date(2026,7,24,9,0)),  '2026-08-24');
eq('weekOf: Wednesday', M.weekOf(new Date(2026,7,26,9,0)),  '2026-08-24');
eq('weekOf: Sunday',    M.weekOf(new Date(2026,7,30,23,0)), '2026-08-24');
eq('weekOf: next Mon',  M.weekOf(new Date(2026,7,31,0,1)),  '2026-08-31');

// ---- review state machine ----
const r = M.createEmptyData();
const mon = new Date(2026,7,24,8,0);
eq('review: due on Monday', M.reviewState(r, mon), 'due');
M.deferReview(r, M.weekOf(mon));
// deferReview stamps the real clock; rewrite it so we can simulate that Monday.
r.weeklyReviews[0].deferrals = [new Date(2026,7,24,8,10).toISOString()];
eq('review: pending right after Later', M.reviewState(r, new Date(2026,7,24,8,30)), 'pending');
eq('review: due again 3h later', M.reviewState(r, new Date(2026,7,24,11,30)), 'due');
// A deferral stamped in the future (skewed clock on another synced machine)
// must not silence the prompt forever.
r.weeklyReviews[0].deferrals = [new Date(2027,0,1,8,0).toISOString()];
eq('review: future-dated deferral ignored', M.reviewState(r, new Date(2026,7,24,11,30)), 'due');
r.weeklyReviews[0].deferrals = [new Date(2026,7,24,8,10).toISOString()];
eq('review: deferral recorded in data', r.weeklyReviews[0].deferrals.length, 1);
eq('review: missed on Tuesday', M.reviewState(r, new Date(2026,7,25,9,0)), 'missed');

// A brand-new dataset must not claim you missed a review it never offered.
const fresh = M.createEmptyData();
eq('review: silent for a dataset created after that Monday',
   M.reviewState(fresh, new Date(2026,7,25,9,0)), 'none');
const older = M.createEmptyData();
older.meta.createdAt = new Date(2026,7,20,9,0).toISOString();
eq('review: missed when the app existed that Monday',
   M.reviewState(older, new Date(2026,7,25,9,0)), 'missed');
eq('review: still due on the Monday itself',
   M.reviewState(older, new Date(2026,7,24,9,0)), 'due');

const r2 = M.createEmptyData();
M.skipReview(r2, M.weekOf(mon));
eq('review: skipped is silent Monday', M.reviewState(r2, new Date(2026,7,24,15,0)), 'none');
eq('review: skipped is silent Tuesday', M.reviewState(r2, new Date(2026,7,25,9,0)), 'none');

const r3 = M.createEmptyData();
M.addCard(r3, 'commit me', 'inprogress');
M.completeReview(r3, M.weekOf(mon));
eq('review: completed is silent', M.reviewState(r3, new Date(2026,7,24,15,0)), 'none');
eq('review: commitments snapshotted', r3.weeklyReviews[0].commitmentIds.length, 1);

// ---- validation ----
const v1 = M.validateData(null);
ok('validate: rejects null', !v1.ok);
const v2 = M.validateData({ schemaVersion: 99, app:'Forefront', meta:{}, cards:[], weeklyReviews:[] });
ok('validate: rejects newer schema', !v2.ok);
ok('validate: says so clearly', /schema version 99/.test(v2.errors[0]));

const v3 = M.validateData({
  schemaVersion: 1, app: 'Forefront', meta: {},
  cards: [
    { id:'x', title:'good', lane:'projects', order:0, createdAt:'2026-01-01T00:00:00Z' },
    { id:'x', title:'dup id', lane:'projects', order:1, createdAt:'2026-01-01T00:00:00Z' },
    { id:'y', title:'bad lane', lane:'nonsense', order:0, createdAt:'2026-01-01T00:00:00Z' },
    { id:'z', title:'', lane:'projects', order:0 },
    'not an object',
    { id:'w', title:'keeps extras', lane:'inbox', order:0, createdAt:'2026-01-01T00:00:00Z',
      aiNote:'groomed by Claude', someFutureField:{deep:true} }
  ],
  weeklyReviews: [
    { weekOf:'2026-08-24', status:'completed', completedAt:'2026-08-24T10:00:00Z' },
    { weekOf:'garbage' },
    { weekOf:'2026-08-24', status:'skipped' }
  ]
});
ok('validate: accepts repairable data', v3.ok);
eq('validate: kept 4 cards', v3.data.cards.length, 4);
eq('validate: rejected 2 (untitled + non-object)', v3.rejected.filter(x=>/Card/.test(x)).length, 2);
ok('validate: regenerated duplicate id', v3.data.cards[0].id !== v3.data.cards[1].id);
eq('validate: bad lane -> inbox', v3.data.cards.find(c=>c.title==='bad lane').lane, 'inbox');
eq('validate: unknown fields preserved', v3.data.cards.find(c=>c.title==='keeps extras').aiNote, 'groomed by Claude');
eq('validate: nested unknown preserved', v3.data.cards.find(c=>c.title==='keeps extras').someFutureField, {deep:true});
eq('validate: kept 1 review', v3.data.weeklyReviews.length, 1);
eq('validate: rejected 2 reviews', v3.rejected.filter(x=>/Weekly/.test(x)).length, 2);

const v4 = M.validateData({ schemaVersion:1, meta:{}, cards:[
  { id:'a', title:'orphan completion', lane:'projects', order:0, createdAt:'2026-01-01T00:00:00Z', completedAt:'2026-01-02T00:00:00Z' },
  { id:'b', title:'done без stamp', lane:'done', order:0, createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-03T00:00:00Z' }
], weeklyReviews:[] });
eq('validate: completedAt implies done lane', v4.data.cards.find(c=>c.id==='a').lane, 'done');
eq('validate: done lane implies completedAt', v4.data.cards.find(c=>c.id==='b').completedAt, '2026-01-03T00:00:00.000Z');

// ---- lane names as people write them ----
eq('lane: id',            M.resolveLane('inprogress'), 'inprogress');
eq('lane: label',         M.resolveLane('In Progress'), 'inprogress');
eq('lane: hyphenated',    M.resolveLane('in-progress'), 'inprogress');
eq('lane: synonym',       M.resolveLane('doing'), 'inprogress');
eq('lane: just do it',    M.resolveLane('Just Do It'), 'justdoit');
eq('lane: shouty',        M.resolveLane('  JUSTDOIT  '), 'justdoit');
eq('lane: unknown',       M.resolveLane('someday maybe'), null);
eq('lane: ambiguous word stays unknown', M.resolveLane('todo'), null);
eq('lane: not a string',  M.resolveLane(3), null);

// ---- comments and trailing commas ----
const relaxed = M.relaxJSON(`{
  // a line comment
  "a": 1, /* and a block one */
  "b": [1, 2, 3,],
}`);
ok('relax: reports that it changed something', relaxed.changed);
eq('relax: parses afterwards', JSON.parse(relaxed.text), { a: 1, b: [1, 2, 3] });

const urlish = '{"title":"see https://example.com // not a comment","n":1}';
eq('relax: leaves // inside a string alone', JSON.parse(M.relaxJSON(urlish).text).title,
   'see https://example.com // not a comment');
ok('relax: reports no change to plain JSON', M.relaxJSON(urlish).changed === false);
eq('relax: leaves an escaped quote alone',
   JSON.parse(M.relaxJSON('{"t":"a \\" b // c"}').text).t, 'a " b // c');

ok('parseLoose: plain JSON needs no tolerance', M.parseLoose('{"a":1}').tolerated.length === 0);
ok('parseLoose: commented JSON is read', M.parseLoose('// hi\n{"a":1}').ok);
ok('parseLoose: and says it was tolerated', M.parseLoose('// hi\n{"a":1}').tolerated.length === 1);
ok('parseLoose: rubbish still fails', M.parseLoose('{not json at all').ok === false);
ok('parseLoose: failure explains itself', /not readable as JSON/.test(M.parseLoose('{{{').error));

// ---- looser shapes an assistant might produce ----
const bare = M.readAny('["Call the vendor back", "Book the offsite room"]');
ok('readAny: a bare list of titles is a valid file', bare.ok);
eq('readAny: both became cards', bare.data.cards.map(c => c.title),
   ['Call the vendor back', 'Book the offsite room']);
eq('readAny: and landed in Inbox', bare.data.cards.map(c => c.lane), ['inbox', 'inbox']);

const grouped = M.readAny(`{
  // stickies, sorted
  "Just Do It": ["Book the room"],
  "in progress": [{ "title": "Finish the draft", "note": "sections 1-3 done" }]
}`);
ok('readAny: lane-keyed groups are accepted', grouped.ok);
eq('readAny: group name resolved to a lane',
   grouped.data.cards.find(c => c.title === 'Book the room').lane, 'justdoit');
eq('readAny: singular "note" is read as notes',
   grouped.data.cards.find(c => c.title === 'Finish the draft').notes, 'sections 1-3 done');
ok('readAny: every card got an id', grouped.data.cards.every(c => typeof c.id === 'string' && c.id));

const spelled = M.readAny('{"cards":[{"title":"x","lane":"In Progress"}]}');
eq('readAny: a written-out lane name is understood', spelled.data.cards[0].lane, 'inprogress');
ok('readAny: and says so', spelled.warnings.some(w => /read as In Progress/.test(w)));

// ---- adding rather than replacing ----
const board = M.createEmptyData();
M.addCard(board, 'already here', 'projects');
const incoming = M.readAny('[{"title":"new one","lane":"projects"},{"title":"already here","lane":"projects"}]');
const merged = M.mergeCards(board, incoming.data.cards);
eq('merge: both added', merged.added, 2);
eq('merge: existing card is still on top',
   M.laneCards(board, 'projects').map(c => c.title), ['already here', 'new one', 'already here']);
eq('merge: duplicate title reported', merged.duplicates, ['already here']);
eq('merge: orders stay dense', M.laneCards(board, 'projects').map(c => c.order), [0, 1, 2]);

const collide = M.createEmptyData();
const mine = M.addCard(collide, 'mine', 'projects');
M.mergeCards(collide, [{ id: mine.id, title: 'theirs', lane: 'projects', order: 0,
                         createdAt: M.nowISO(), updatedAt: M.nowISO(), notes: '' }]);
eq('merge: two cards after an id collision', collide.cards.length, 2);
ok('merge: the colliding id was regenerated', collide.cards[0].id !== collide.cards[1].id);

// ---- the annotated file reads back in ----
const annotated = M.annotate(d);
ok('annotate: is not valid JSON on its own', (() => {
  try { JSON.parse(annotated); return false; } catch (e) { return true; }
})());
const readBack = M.readAny(annotated);
ok('annotate: but Forefront reads it', readBack.ok);
eq('annotate: same cards', readBack.data.cards.map(c => c.id), d.cards.map(c => c.id));
eq('annotate: same reviews', readBack.data.weeklyReviews.length, d.weeklyReviews.length);
ok('annotate: carries the format guide', annotated.indexOf('// THE LANES') !== -1);

// ---- round trip ----
const rt = M.validateData(JSON.parse(M.serialize(d)));
ok('roundtrip: valid', rt.ok);
eq('roundtrip: card count', rt.data.cards.length, d.cards.length);
eq('roundtrip: no warnings', rt.warnings, []);
eq('roundtrip: no rejects', rt.rejected, []);

console.log(fail === 0
  ? `\n  ✓ ${pass} model checks passed\n`
  : `\n  ${pass} passed, ${fail} FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
