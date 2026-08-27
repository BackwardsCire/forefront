#!/usr/bin/env node
/**
 * Dev-only: drive the real index.html in headless Chrome and assert on what it
 * actually does. Run: node tools/browsertest.js
 *
 * It builds a temporary page from index.html itself — same markup, same
 * scripts, same stylesheets, same file:// origin — with a seeding script in the
 * head (which runs before the deferred app scripts) and a test script at the
 * end. Nothing about the app is stubbed.
 *
 * This suite is for development only. The supported localhost launcher has no
 * npm dependencies and can use either Node or Python 3.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const chrome = ['google-chrome', 'chromium', 'chromium-browser']
  .find(bin => { try { execFileSync('which', [bin], { stdio: 'pipe' }); return true; } catch (e) { return false; } });

if (!chrome) { console.error('No Chrome/Chromium found; skipping browser tests.'); process.exit(0); }

let runSeq = 0;

function runPage(seedJSON, testBody, opts = {}) {
  // A fresh profile per run. Reusing one directory across back-to-back Chrome
  // launches intermittently hits the profile lock from the previous instance,
  // which shows up as a page that never boots.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-chrome-'));

  const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  const seed = `<script>
    ${opts.shimRAF ? `
    // Headless Chrome under --virtual-time-budget fires requestAnimationFrame
    // exactly once, while setTimeout keeps running. dragdrop.js throttles its
    // pointermove work through rAF — correct in a real browser, untestable
    // here — so swap in an equivalent scheduler. This changes when the drag
    // logic is called, not what it does.
    window.requestAnimationFrame = function (fn) { return setTimeout(function () { fn(performance.now()); }, 8); };
    window.cancelAnimationFrame = function (id) { clearTimeout(id); };` : ''}
    try {
      localStorage.clear();
      ${seedJSON ? `localStorage.setItem('forefront.data.v1', ${JSON.stringify(seedJSON)});` : ''}
    } catch (e) {}
    ${opts.now ? `
    // Freeze "now" so review-day behaviour can be tested on a real Monday.
    (function () {
      var FIXED = new Date(${JSON.stringify(opts.now)}).getTime();
      var RealDate = Date;
      function FakeDate(...args) {
        if (!(this instanceof FakeDate)) return new RealDate(FIXED).toString();
        return args.length ? new RealDate(...args) : new RealDate(FIXED);
      }
      FakeDate.prototype = RealDate.prototype;
      FakeDate.now = function () { return FIXED; };
      FakeDate.parse = RealDate.parse;
      FakeDate.UTC = RealDate.UTC;
      window.Date = FakeDate;
      // Lets a test roll the clock over midnight.
      window.__setNow = function (iso) { FIXED = new RealDate(iso).getTime(); };
    })();` : ''}
  </script>`;

  const harness = `<script>
    window.__results = [];
    window.__errors = [];
    window.addEventListener('error', e => window.__errors.push(String(e.message) + ' @ ' + e.filename + ':' + e.lineno));
    window.addEventListener('unhandledrejection', e => window.__errors.push('unhandled rejection: ' + String(e.reason && e.reason.stack || e.reason)));
    function ok(name, cond, detail) { window.__results.push({ name, pass: !!cond, detail: detail || '' }); }
    function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
    function until(fn, label, ms) {
      ms = ms || 5000;
      const start = Date.now();
      return new Promise((res, rej) => {
        (function poll() {
          let v; try { v = fn(); } catch (e) { v = null; }
          if (v) return res(v);
          if (Date.now() - start > ms) return rej(new Error('timed out waiting for ' + (label || fn.toString())));
          setTimeout(poll, 25);
        })();
      });
    }
    function pt(type, x, y, extra) {
      return new PointerEvent(type, Object.assign({
        pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
        clientX: x, clientY: y, bubbles: true, cancelable: true
      }, extra || {}));
    }
    function centre(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    /** Drag a card onto a target point, the way a hand would: press, creep past
     *  the threshold, travel in steps, release. */
    async function drag(card, toX, toY) {
      const from = centre(card);
      card.dispatchEvent(pt('pointerdown', from.x, from.y));
      window.dispatchEvent(pt('pointermove', from.x + 2, from.y + 2));   // under threshold
      window.dispatchEvent(pt('pointermove', from.x + 14, from.y + 14)); // engages
      await wait(30);
      for (let i = 1; i <= 6; i++) {
        window.dispatchEvent(pt('pointermove',
          from.x + (toX - from.x) * i / 6, from.y + (toY - from.y) * i / 6));
        await wait(24);
      }
      window.dispatchEvent(pt('pointerup', toX, toY, { buttons: 0 }));
      await wait(120);
    }
    /**
     * Press Escape on a native <dialog>.
     *
     * A synthetic keydown will not do it: dialog dismissal is user-agent
     * behaviour driven by real input, and what it actually does is fire a
     * cancelable 'cancel' event. Dispatching that exercises the app's own
     * handler, which is the part worth testing.
     */
    function escapeDialog(dialog) {
      dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    }
    function key(el, k, init) { el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, init || {}))); }
    function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
    function text(sel, r) { const n = (r||document).querySelector(sel); return n ? n.textContent.trim() : null; }
    function all(sel, r) { return Array.from((r||document).querySelectorAll(sel)); }
    function data() { return window.FF.app.api.getData(); }

    (async function () {
      try {
        await until(() => document.querySelector('#app .focus, #app .board'), 'the app to boot');
        ${testBody}
      } catch (e) {
        window.__results.push({ name: 'harness', pass: false, detail: String(e && e.stack || e) });
      }
      if (window.__errors.length) {
        window.__results.push({ name: 'uncaught error in page', pass: false, detail: window.__errors.join(' | ') });
      }
      const out = document.createElement('div');
      out.id = 'testresults';
      out.textContent = JSON.stringify(window.__results);
      document.body.appendChild(out);
    })();
  </script>`;

  const page = template
    .replace('<meta charset="utf-8">', '<meta charset="utf-8">' + seed)
    .replace('</body>', harness + '</body>');

  // A unique name per run: the page must live in the repo root for its
  // relative css/ and js/ paths to resolve, and a retry must not delete the
  // file its own caller is still holding.
  const file = path.join(root, `_browsertest.${process.pid}.${runSeq++}.tmp.html`);
  fs.writeFileSync(file, page);

  try {
    let out;
    try {
      out = execFileSync(chrome, [
      '--headless=new', '--no-sandbox', '--disable-gpu',
      `--user-data-dir=${profile}`,
      // Headless defaults to 800x600, which puts half the board outside the
      // viewport — elementFromPoint then returns nothing and drags land in the
      // wrong lane. Forefront is a desktop tool; test it at a desktop size.
      `--window-size=${opts.width || 1920},${opts.height || 1080}`,
      '--virtual-time-budget=' + (opts.budget || 60000),
      '--dump-dom', 'file://' + file
      ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      // Chrome itself failed to run — under a loaded machine it can be killed
      // before it renders. Distinguish that from a failing assertion.
      const why = (e.stderr || e.message || '').toString().trim().split('\n').slice(-3).join(' ');
      if (!opts._retried) return runPage(seedJSON, testBody, Object.assign({}, opts, { _retried: true }));
      return [{ name: 'chrome', pass: false, detail: 'Chrome did not run: ' + why.slice(0, 300) }];
    }

    const m = out.match(/<div id="testresults">([\s\S]*?)<\/div>/);
    if (!m) {
      if (!opts._retried) return runPage(seedJSON, testBody, Object.assign({}, opts, { _retried: true }));
      return [{ name: 'page', pass: false,
                detail: 'no results element after two attempts. Chrome produced ' + out.length +
                        ' bytes of DOM' + (/id="app"/.test(out) ? ' (the app markup rendered, so the harness script did not finish — usually a loaded machine)' : ' (the page did not render at all)') }];
    }
    const decoded = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    return JSON.parse(decoded);
  } finally {
    if (process.env.FF_KEEP && fs.existsSync(file)) fs.copyFileSync(file, file + '.kept');
    fs.rmSync(file, { force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------
const example = fs.readFileSync(path.join(root, 'sample-data', 'example.json'), 'utf8');
let pass = 0, fail = 0;

function report(title, results) {
  console.log('\n' + title);
  results.forEach(r => {
    if (r.pass) { pass++; console.log('  ok    ' + r.name); }
    else { fail++; console.error('  FAIL  ' + r.name + (r.detail ? '\n        ' + r.detail : '')); }
  });
}

report('Focus View with real data', runPage(example, `
  eq('shows exactly three commitments', all('.commitment').length, 3);
  ok('commitment text is the In Progress lane, in order',
     all('.commitment__title').map(n => n.textContent).join('|').includes('Complete team financial analysis'));
  ok('shows today\\'s date', /\\w+day/.test(text('.focus__date') || ''));
  ok('does NOT show the backlog', all('.lane').length === 0);
  ok('shows lane counts', all('.count').length >= 4);
  eq('inbox count is 3', text('.count .count__value'), '3');
  ok('shows a quick capture control', !!document.querySelector('.capture-button'));
  ok('ages are rendered', all('.commitment__age').every(n => /^(today|\\d+d)$/.test(n.textContent)));
`));

report('Quick Capture', runPage(example, `
  key(document.body, 'n');
  const input = await until(() => document.querySelector('.capture__input'));
  ok('capture field is focused immediately', document.activeElement === input);
  input.value = 'Ask Mike whether contractor extensions are in Q4 funding';
  input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !document.querySelector('.capture__input'));
  ok('dialog closed after Enter', !document.querySelector('.capture__input'));
  const inbox = data().cards.filter(c => c.lane === 'inbox' && !c.discardedAt);
  eq('landed in Inbox', inbox.length, 4);
  eq('newest capture is at the top', inbox.sort((a,b)=>a.order-b.order)[0].title,
     'Ask Mike whether contractor extensions are in Q4 funding');
  ok('was written to browser storage',
     JSON.parse(localStorage.getItem('forefront.data.v1')).cards.some(c => c.title.startsWith('Ask Mike whether contractor')));
  eq('count updated on screen', text('.count .count__value'), '4');

  key(document.body, 'n');
  const i2 = await until(() => document.querySelector('.capture__input'));
  i2.value = 'typed but abandoned';
  escapeDialog(i2.closest('dialog'));
  await until(() => !document.querySelector('.capture__input'), 'capture to close');
  ok('Escape closes the capture box', !document.querySelector('.capture__input'));
  eq('and nothing was saved', data().cards.length, 26);
  ok('and the abandoned text is gone', !data().cards.some(c => c.title === 'typed but abandoned'));
`));

report('Board View', runPage(example, `
  key(document.body, 'b');
  await until(() => document.querySelector('.board'));
  eq('five working lanes', all('.lane').length, 5);
  ok('Inbox is a strip, not a lane', !!document.querySelector('.inbox') && !document.querySelector('.lane--inbox'));
  eq('lane order', all('.lane__title').map(n => n.textContent),
     ['Management','Projects','Just Do It','In Progress','Done']);
  eq('management count', text('.lane--management .lane__count'), '5');
  eq('just do it count', text('.lane--justdoit .lane__count'), '6');
  // Asserted as a rule, not a count: example.json carries real dates, so a
  // fixed number here silently rots as the demo data ages.
  const WINDOW = window.FF.C.DONE_VISIBLE_DAYS;
  const shown = all('.lane--done .card').length;
  const recent = data().cards.filter(c => c.completedAt &&
    window.FF.model.dayDiff(new Date(c.completedAt), new Date()) < WINDOW).length;
  eq('Done shows exactly the completions inside the window', shown, recent);
  ok('and the window is actually excluding something',
     data().cards.filter(c => c.completedAt).length > recent,
     'total completed=' + data().cards.filter(c => c.completedAt).length + ' recent=' + recent);
  ok('Just Do It lane is narrower than Projects',
     document.querySelector('.lane--justdoit').getBoundingClientRect().width <
     document.querySelector('.lane--projects').getBoundingClientRect().width);
  ok('In Progress lane is wider than Projects',
     document.querySelector('.lane--inprogress').getBoundingClientRect().width >
     document.querySelector('.lane--projects').getBoundingClientRect().width);
  ok('top three In Progress cards are marked for Focus',
     all('.lane--inprogress .card--focus').length === 3);
`));

report('Completing and discarding', runPage(example, `
  key(document.body, 'b');
  await until(() => document.querySelector('.board'));
  const card = document.querySelector('.lane--management .card');
  const title = card.querySelector('.card__title').textContent;
  click(card.querySelector('.card__done'));
  await wait(120);
  const done = data().cards.find(c => c.title === title);
  eq('moved to Done', done.lane, 'done');
  ok('completion time recorded', !!done.completedAt);
  eq('records the lane it came from', done.sourceLane, 'management');
  eq('management count dropped', text('.lane--management .lane__count'), '4');

  const victim = document.querySelector('.lane--projects .card');
  const vtitle = victim.querySelector('.card__title').textContent;
  click(victim.querySelector('.card__menu'));
  const menu = await until(() => document.querySelector('.menu'));
  const discard = Array.from(menu.querySelectorAll('.menu__item')).find(b => b.textContent === 'Discard');
  click(discard);
  await wait(120);
  const dropped = data().cards.find(c => c.title === vtitle);
  ok('discard records a timestamp', !!dropped.discardedAt);
  ok('discarded card is kept in the data', !!dropped);
  ok('discarded card left the board', !all('.lane--projects .card__title').some(n => n.textContent === vtitle));
`));

report('Keyboard reordering', runPage(example, `
  key(document.body, 'b');
  await until(() => document.querySelector('.board'));
  const before = all('.lane--management .card__title').map(n => n.textContent);
  const first = document.querySelector('.lane--management .card');
  first.focus();
  key(first, 'ArrowDown', { altKey: true });
  await wait(140);
  const after = all('.lane--management .card__title').map(n => n.textContent);
  eq('card moved down one', after[1], before[0]);
  eq('the card below moved up', after[0], before[1]);
  ok('order persisted to storage', (function () {
    const stored = JSON.parse(localStorage.getItem('forefront.data.v1'));
    const mgmt = stored.cards.filter(c => c.lane === 'management' && !c.discardedAt).sort((a,b)=>a.order-b.order);
    return mgmt[0].title === before[1];
  })());
  ok('keyboard focus stayed on the moved card',
     document.activeElement.querySelector('.card__title').textContent === before[0]);
  ok('orders are dense integers', (function () {
    const mgmt = data().cards.filter(c => c.lane === 'management' && !c.discardedAt).map(c => c.order).sort((a,b)=>a-b);
    return mgmt.every((o, i) => o === i);
  })());
`));

report('Dragging', runPage(example, `
  key(document.body, 'b');
  await until(() => document.querySelector('.board'), 'the board');

  // --- across lanes: Management -> In Progress ---
  const card = document.querySelector('.lane--management .card');
  const title = card.querySelector('.card__title').textContent;
  const target = document.querySelector('.lane--inprogress .lane__list');
  const tr = target.getBoundingClientRect();
  await drag(card, tr.left + tr.width / 2, tr.top + 12);
  eq('card changed lane', window.FF.model.findCard(data(), card.dataset.cardId).lane, 'inprogress');
  eq('landed at the position it was dropped',
     all('.lane--inprogress .card__title')[0].textContent, title);
  eq('source lane renumbered densely',
     data().cards.filter(c => c.lane === 'management' && !c.discardedAt).map(c => c.order).sort((a,b)=>a-b),
     [0,1,2,3]);
  ok('persisted', JSON.parse(localStorage.getItem('forefront.data.v1'))
       .cards.find(c => c.title === title).lane === 'inprogress');

  // --- within a lane: bottom of Just Do It to the top ---
  const jdi = all('.lane--justdoit .card');
  const last = jdi[jdi.length - 1];
  const lastTitle = last.querySelector('.card__title').textContent;
  const firstBox = jdi[0].getBoundingClientRect();
  await drag(last, firstBox.left + firstBox.width / 2, firstBox.top + 2);
  eq('reordered to the top', all('.lane--justdoit .card__title')[0].textContent, lastTitle);
  eq('order is dense after reordering',
     data().cards.filter(c => c.lane === 'justdoit' && !c.discardedAt).map(c => c.order).sort((a,b)=>a-b),
     [0,1,2,3,4,5]);

  // --- dropping on Done completes ---
  const proj = document.querySelector('.lane--projects .card');
  const projTitle = proj.querySelector('.card__title').textContent;
  const doneList = document.querySelector('.lane--done .lane__list');
  const dr = doneList.getBoundingClientRect();
  await drag(proj, dr.left + dr.width / 2, dr.top + 12);
  const finished = data().cards.find(c => c.title === projTitle);
  eq('dropping on Done marks it done', finished.lane, 'done');
  ok('and stamps the completion time', !!finished.completedAt);
  eq('and remembers where it came from', finished.sourceLane, 'projects');

  // --- dragging back out un-completes ---
  const doneCard = Array.from(document.querySelectorAll('.lane--done .card'))
    .find(c => c.querySelector('.card__title').textContent === projTitle);
  const pl = document.querySelector('.lane--projects .lane__list').getBoundingClientRect();
  await drag(doneCard, pl.left + pl.width / 2, pl.top + 12);
  const revived = data().cards.find(c => c.title === projTitle);
  eq('dragging out of Done clears the lane', revived.lane, 'projects');
  eq('and clears the completion time', revived.completedAt, null);

  // --- Escape cancels mid-drag ---
  const before = all('.lane--management .card__title').map(n => n.textContent);
  const victim = document.querySelector('.lane--management .card');
  const c0 = centre(victim);
  victim.dispatchEvent(pt('pointerdown', c0.x, c0.y));
  window.dispatchEvent(pt('pointermove', c0.x + 20, c0.y + 20));
  await wait(30);
  ok('a drag is in flight', document.body.classList.contains('is-dragging'));
  ok('a floating proxy is shown', !!document.querySelector('.card--proxy'));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(80);
  ok('escape ends the drag', !document.body.classList.contains('is-dragging'));
  ok('the proxy is gone', !document.querySelector('.card--proxy'));
  eq('nothing moved', all('.lane--management .card__title').map(n => n.textContent), before);

  // --- a plain click is not a drag ---
  const clickCard = document.querySelector('.lane--management .card');
  const cc = centre(clickCard);
  const lanesBefore = data().cards.map(c => c.lane).join(',');
  clickCard.dispatchEvent(pt('pointerdown', cc.x, cc.y));
  window.dispatchEvent(pt('pointermove', cc.x + 2, cc.y + 1));
  window.dispatchEvent(pt('pointerup', cc.x + 2, cc.y + 1, { buttons: 0 }));
  await wait(80);
  eq('a small movement stays a click', data().cards.map(c => c.lane).join(','), lanesBefore);
  ok('no drag state left behind', !document.body.classList.contains('is-dragging'));
`, { shimRAF: true }));

report('Text is never treated as markup', runPage(JSON.stringify({
  schemaVersion: 1, app: 'Forefront',
  meta: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  cards: [
    { id: 'x1', title: '<img src=x onerror="window.__pwned=1">', notes: '', lane: 'inprogress', order: 0, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'x2', title: '<script>window.__pwned2=1<\\/script>', notes: '<b>bold?</b>', lane: 'management', order: 0, createdAt: '2026-01-01T00:00:00Z' }
  ],
  weeklyReviews: []
}), `
  ok('no injected image element', !document.querySelector('#app img'));
  ok('onerror handler never ran', !window.__pwned);
  ok('inline script never ran', !window.__pwned2);
  eq('title renders as literal text', text('.commitment__title'), '<img src=x onerror="window.__pwned=1">');
  key(document.body, 'b');
  await until(() => document.querySelector('.board'));
  ok('no injected bold element in notes', !document.querySelector('#app .card__notes b'));
  eq('notes render as literal text', text('.lane--management .card__notes'), '<b>bold?</b>');
`));

report('Monday review ritual', runPage(example, `
  ok('prompt is offered on a Monday', !!document.querySelector('.review-prompt'));
  ok('prompt is not a modal', !document.querySelector('dialog[open]'));
  eq('offers three choices',
     all('.review-prompt__actions .btn').map(b => b.textContent),
     ['Review now','Later','Skip this week']);

  click(all('.review-prompt__actions .btn')[1]); // Later
  await wait(140);
  ok('prompt gets out of the way', !document.querySelector('.review-prompt'));
  eq('a quiet indicator remains', text('.review-indicator'), 'Review pending');
  const rec = data().weeklyReviews.find(r => r.weekOf === '2026-08-24');
  eq('the deferral is recorded in the data file, not just the browser', rec.deferrals.length, 1);
  eq('status is still pending', rec.status, 'pending');

  click(document.querySelector('.review-indicator'));
  await until(() => document.querySelector('.rail'));
  eq('review starts on Look Back', text('.rail__title'), 'Look back');
  eq('progress is shown', text('.rail__progress'), '1 of 5');
  ok('recent completions are listed', all('.lookback__item').length > 0);
  ok('the board is usable underneath', all('.lane').length === 5);

  const next = () => click(Array.from(document.querySelectorAll('.rail__actions .btn')).find(b => b.textContent === 'Next'));
  next(); await wait(60);
  eq('step 2 is triage', text('.rail__title'), 'Empty the Inbox');
  next();
  const triageCheck = await until(() => document.querySelector('.dialog--confirm'), 'the triage checkpoint');
  ok('continuing with Inbox items requires a conscious choice', /still waiting for a decision/.test(text('.dialog__message', triageCheck) || ''));
  eq('the review stays on triage until that choice is made', text('.rail__title'), 'Empty the Inbox');
  click(Array.from(triageCheck.querySelectorAll('.btn')).find(b => b.textContent === 'Continue review'));
  await wait(60);
  eq('step 3 is prune', text('.rail__title'), 'Decide what is still worth carrying');
  ok('aging cards are marked during prune', all('.card--stale').length > 0);
  next(); await wait(60);
  eq('step 4 is re-rank', text('.rail__title'), 'Put them in order');
  ok('re-rank guidance describes the interaction that exists', /cards within/.test(text('.rail__guide')));
  ok('aging marks are gone again afterwards', all('.card--stale').length === 0);
  next(); await wait(60);
  eq('step 5 is commit', text('.rail__title'), 'Commit');
  ok('asks the Friday question', /Friday/.test(text('.rail__guide')));
  eq('lists the current commitments', all('.commit-list__item').length, 3);

  const extraCommitment = data().cards.find(c => c.lane === 'projects' && !c.discardedAt);
  FF.app.actions.move(extraCommitment.id, 'inprogress', 3);
  await wait(60);
  eq('a fourth commitment is visible before finishing', all('.commit-list__item').length, 4);
  click(Array.from(document.querySelectorAll('.rail__actions .btn')).find(b => b.textContent === 'Finish review'));
  const commitCheck = await until(() => document.querySelector('.dialog--confirm'), 'the commitment checkpoint');
  ok('finishing with too many commitments requires a conscious choice', /Focus will show only the first 3/.test(text('.dialog__message', commitCheck) || ''));
  click(Array.from(commitCheck.querySelectorAll('.btn')).find(b => b.textContent === 'Keep reviewing'));
  await wait(40);
  eq('cancelling the checkpoint keeps the review open', text('.rail__title'), 'Commit');

  FF.app.actions.move(extraCommitment.id, 'projects', 0);
  await wait(60);
  click(Array.from(document.querySelectorAll('.rail__actions .btn')).find(b => b.textContent === 'Finish review'));
  await until(() => document.querySelector('.focus'));
  ok('returns to Focus', !!document.querySelector('.focus'));
  ok('the backlog is gone again', all('.lane').length === 0);
  const done = data().weeklyReviews.find(r => r.weekOf === '2026-08-24');
  eq('review recorded as completed', done.status, 'completed');
  eq('commitments snapshotted', done.commitmentIds.length, 3);
  ok('completion time recorded', !!done.completedAt);
  ok('prompt does not come back', !document.querySelector('.review-prompt'));
  ok('no indicator either', !document.querySelector('.review-indicator'));
`, { now: '2026-08-24T08:00:00' }));

report('Skip this week', runPage(example, `
  click(all('.review-prompt__actions .btn')[2]); // Skip
  await wait(140);
  const rec = data().weeklyReviews.find(r => r.weekOf === '2026-08-24');
  eq('recorded as an intentional skip', rec.status, 'skipped');
  ok('nothing left on screen', !document.querySelector('.review-prompt') && !document.querySelector('.review-indicator'));
`, { now: '2026-08-24T08:00:00' }));

report('Export carries the whole application state', runPage(example, `
  key(document.body, 'b');
  await until(() => document.querySelector('.board'));
  const card = document.querySelector('.lane--management .card');
  click(card.querySelector('.card__done'));
  await wait(120);

  const json = window.FF.model.serialize(data());
  const parsed = JSON.parse(json);
  eq('schema version present', parsed.schemaVersion, 1);
  ok('open cards included', parsed.cards.some(c => c.lane === 'projects' && !c.completedAt));
  ok('inbox included', parsed.cards.some(c => c.lane === 'inbox'));
  ok('completed history included, past the Done window',
     parsed.cards.filter(c => c.completedAt).length === 5);
  ok('discarded work included', parsed.cards.some(c => c.discardedAt));
  ok('ordering included', parsed.cards.every(c => typeof c.order === 'number'));
  ok('timestamps included', parsed.cards.every(c => !!c.createdAt && !!c.updatedAt));
  ok('review history included', parsed.weeklyReviews.length >= 2);
  ok('deferral history included', parsed.weeklyReviews.some(r => Array.isArray(r.deferrals)));
  ok('metadata included', !!parsed.meta.createdAt && !!parsed.meta.updatedAt);
  eq('nothing in the data is absent from the export',
     JSON.stringify(Object.keys(parsed).sort()), JSON.stringify(['app','cards','meta','schemaVersion','weeklyReviews']));

  const round = window.FF.model.validateData(JSON.parse(json));
  ok('re-imports cleanly', round.ok);
  eq('no warnings on round trip', round.warnings.length, 0);
  eq('nothing rejected on round trip', round.rejected.length, 0);
  eq('same card count after round trip', round.data.cards.length, parsed.cards.length);
`));

report('Import safety', runPage(example, `
  const M = window.FF.model;
  const before = data().cards.length;

  const bad = M.validateData(JSON.parse('{"schemaVersion":9,"app":"Forefront","meta":{},"cards":[],"weeklyReviews":[]}'));
  ok('refuses a newer schema', !bad.ok);
  eq('board untouched', data().cards.length, before);

  const junk = M.validateData({ nope: true });
  ok('refuses a non-Forefront object', !junk.ok);

  const partial = M.validateData({
    schemaVersion: 1, meta: {}, weeklyReviews: [],
    cards: [
      { id: 'a', title: 'keeps this', lane: 'projects', order: 0, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'b', title: '', lane: 'projects', order: 1, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'c', title: 'unknown lane', lane: 'wat', order: 2, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'd', title: 'ai annotated', lane: 'inbox', order: 3, createdAt: '2026-01-01T00:00:00Z', aiSuggestion: 'drop this' }
    ]
  });
  ok('accepts repairable data', partial.ok);
  eq('keeps what it can', partial.data.cards.length, 3);
  eq('reports what it left out', partial.rejected.length, 1);
  ok('reports what it adjusted', partial.warnings.length >= 1);
  eq('unknown lane goes to Inbox', partial.data.cards.find(c => c.title === 'unknown lane').lane, 'inbox');
  eq('an assistant\\'s extra fields survive', partial.data.cards.find(c => c.title === 'ai annotated').aiSuggestion, 'drop this');
`));

report('Connected data file', runPage(example, `
  const M = window.FF.model;

  // A stand-in for a real FileSystemFileHandle. Chrome exposes the genuine API
  // here, but its picker cannot be driven from a script, so the picker is what
  // gets replaced — everything downstream of it is the real code.
  const fakeFile = {
    name: 'forefront-data.json',
    lastModified: 1000,
    content: JSON.stringify({
      schemaVersion: 1, app: 'Forefront',
      meta: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' },
      cards: [{ id: 'from-file-1', title: 'Card that lives in the file', notes: '',
                lane: 'projects', order: 0, createdAt: '2026-08-01T00:00:00Z',
                updatedAt: '2026-08-01T00:00:00Z', completedAt: null, discardedAt: null, sourceLane: null }],
      weeklyReviews: []
    }),
    writes: 0
  };
  const handle = {
    name: fakeFile.name,
    getFile: () => Promise.resolve({
      name: fakeFile.name,
      lastModified: fakeFile.lastModified,
      size: fakeFile.content.length,
      text: () => Promise.resolve(fakeFile.content)
    }),
    createWritable: () => Promise.resolve({
      write: (text) => { fakeFile.pending = text; return Promise.resolve(); },
      close: () => {
        fakeFile.content = fakeFile.pending;
        fakeFile.lastModified += 1000;
        fakeFile.writes++;
        return Promise.resolve();
      }
    }),
    queryPermission: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted')
  };
  window.showOpenFilePicker = () => Promise.resolve([handle]);

  // --- connect through the real UI ---
  key(document.body, 'd');
  await until(() => document.querySelector('.data-panel'), 'the data panel');
  const connect = Array.from(document.querySelectorAll('.data-panel .btn'))
    .find(b => /Connect a data file/.test(b.textContent));
  ok('the panel offers to connect a file', !!connect);
  click(connect);

  // The board is not empty, so it must ask before replacing it.
  const confirmBtn = await until(() => Array.from(document.querySelectorAll('.dialog--confirm .btn'))
    .find(b => /Load the file/.test(b.textContent)), 'the replace confirmation');
  ok('asks before replacing a non-empty board', !!confirmBtn);
  click(confirmBtn);

  await until(() => data().cards.some(c => c.id === 'from-file-1'), 'the file contents to load');
  eq('adopted the file contents', data().cards.length, 1);
  eq('and the file card is there', data().cards[0].title, 'Card that lives in the file');
  ok('the previous board was kept as a recoverable copy', !!FF.storage.readBackup());
  eq('status reports the connection', FF.storage.status().connected, true);
  eq('and names the file', FF.storage.status().fileName, 'forefront-data.json');

  // --- a change writes through to the file ---
  const writesBefore = fakeFile.writes;
  key(document.body, 'n');
  const input = await until(() => document.querySelector('.capture__input'), 'capture');
  input.value = 'written through to the file';
  input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await until(() => fakeFile.writes > writesBefore, 'the debounced file write', 4000);
  ok('the file received the change',
     JSON.parse(fakeFile.content).cards.some(c => c.title === 'written through to the file'));
  ok('and browser storage has it too',
     JSON.parse(localStorage.getItem('forefront.data.v1')).cards.some(c => c.title === 'written through to the file'));

  // --- something else edits the file ---
  const stolen = JSON.parse(fakeFile.content);
  stolen.cards.push({ id: 'edited-elsewhere', title: 'Added by another machine', notes: '',
    lane: 'management', order: 0, createdAt: '2026-08-02T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z',
    completedAt: null, discardedAt: null, sourceLane: null });
  fakeFile.content = JSON.stringify(stolen);
  fakeFile.lastModified += 99999;
  const writesAtConflict = fakeFile.writes;

  key(document.body, 'n');
  const i2 = await until(() => document.querySelector('.capture__input'), 'capture again');
  i2.value = 'made while the file was changed underneath';
  i2.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  await until(() => document.querySelector('.banner--warn'), 'the conflict banner', 5000);
  ok('the external change is reported', /changed outside Forefront/.test(text('.banner__text') || ''));
  eq('and the file was NOT overwritten', fakeFile.writes, writesAtConflict);
  ok('the card added elsewhere is still in the file',
     JSON.parse(fakeFile.content).cards.some(c => c.id === 'edited-elsewhere'));
  ok('and my change is safe in browser storage',
     JSON.parse(localStorage.getItem('forefront.data.v1'))
       .cards.some(c => c.title === 'made while the file was changed underneath'));

  // --- resolving the conflict by loading the file ---
  const loadBtn = Array.from(document.querySelectorAll('.banner .btn'))
    .find(b => /Load the file/.test(b.textContent));
  ok('the banner offers to load the file', !!loadBtn);
  click(loadBtn);
  await until(() => data().cards.some(c => c.id === 'edited-elsewhere'), 'the reload');
  ok('the change made elsewhere is now on the board', true);
  eq('accepting the file discards the stale queued write', FF.storage.hasUnwrittenChanges(), false);
  const acceptedFile = fakeFile.content;
  const writesAfterAccepting = fakeFile.writes;
  await FF.storage.flush();
  eq('a later flush does not overwrite the accepted file', fakeFile.writes, writesAfterAccepting);
  eq('the accepted external contents stay intact', fakeFile.content, acceptedFile);
`));


report('Browser storage blocked while a file is connected', runPage(example, `
  const fakeFile = {
    name: 'forefront-data.json', lastModified: 1000,
    content: JSON.stringify({
      schemaVersion: 1, app: 'Forefront',
      meta: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' },
      cards: [{ id: 'in-the-file', title: 'Card that lives in the file', notes: '',
                lane: 'projects', order: 0, createdAt: '2026-08-01T00:00:00Z',
                updatedAt: '2026-08-01T00:00:00Z', completedAt: null, discardedAt: null, sourceLane: null }],
      weeklyReviews: []
    }), writes: 0
  };
  const handle = {
    name: fakeFile.name,
    getFile: () => Promise.resolve({ name: fakeFile.name, lastModified: fakeFile.lastModified,
      size: fakeFile.content.length, text: () => Promise.resolve(fakeFile.content) }),
    createWritable: () => Promise.resolve({
      write: t => { fakeFile.pending = t; return Promise.resolve(); },
      close: () => { fakeFile.content = fakeFile.pending; fakeFile.lastModified += 1000; fakeFile.writes++; return Promise.resolve(); } }),
    queryPermission: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted')
  };
  window.showOpenFilePicker = () => Promise.resolve([handle]);
  const r = await FF.storage.pickFile();
  // This scenario exercises write-through with browser storage blocked. The
  // live handle is installed before useHandle's background IndexedDB work, so
  // do not make a virtual-time browser test wait on real storage I/O.
  FF.storage.useHandle(r.handle, r.stamp, r.fileName, null);
  await until(() => FF.storage.status().connected, 'the file connection');
  ok('a data file is connected', FF.storage.status().connected);

  // Now browser storage starts refusing writes. The file is still healthy, so
  // the change IS saved -- reporting a failure here would make Quick Capture
  // hold its dialog open and the user retype a card that was already stored.
  const realSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function () { const e = new Error('blocked'); e.name = 'QuotaExceededError'; throw e; };

  const before = data().cards.length;
  key(document.body, 'n');
  const input = await until(() => document.querySelector('.capture__input'), 'capture');
  input.value = 'saved to the file only';
  input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !document.querySelector('.capture__input'), 'the capture box to close');

  ok('the capture box closes, because the change was saved', !document.querySelector('.capture__input'));
  eq('exactly one card was added', data().cards.length, before + 1);
  eq('and there is no duplicate', data().cards.filter(c => c.title === 'saved to the file only').length, 1);
  ok('a banner explains only one place is taking writes',
     /only to|not storing a local copy/i.test(text('.banner__text') || ''));
  await until(() => fakeFile.writes > 0, 'the file write', 4000);
  ok('and the file really did receive it',
     JSON.parse(fakeFile.content).cards.some(c => c.title === 'saved to the file only'));
  Storage.prototype.setItem = realSet;
`));

report('Unreadable browser storage is reported, not mistaken for a fresh start',
  runPage('{this is not json at all', `
  eq('starts with an empty board', data().cards.length, 0);
  ok('and says so plainly', /could not read/i.test(text('.banner__text') || ''));
  eq('the unreadable original is kept', FF.storage.readBackup(), '{this is not json at all');
  key(document.body, 'd');
  await until(() => document.querySelector('.data-panel'), 'panel');
  ok('and the Data panel offers to recover it',
     !!Array.from(document.querySelectorAll('.data-panel .btn')).find(b => /Recover/.test(b.textContent)));
`));

report('A newer board is never silently replaced by an older file', runPage(example, `
  const fakeFile = {
    name: 'forefront-data.json', lastModified: 1000,
    content: JSON.stringify({
      schemaVersion: 1, app: 'Forefront',
      meta: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' },
      cards: [{ id: 'in-the-file', title: 'Card that lives in the file', notes: '',
                lane: 'projects', order: 0, createdAt: '2026-08-01T00:00:00Z',
                updatedAt: '2026-08-01T00:00:00Z', completedAt: null, discardedAt: null, sourceLane: null }],
      weeklyReviews: []
    }), writes: 0
  };
  const handle = {
    name: fakeFile.name,
    getFile: () => Promise.resolve({ name: fakeFile.name, lastModified: fakeFile.lastModified,
      size: fakeFile.content.length, text: () => Promise.resolve(fakeFile.content) }),
    createWritable: () => Promise.resolve({
      write: t => { fakeFile.pending = t; return Promise.resolve(); },
      close: () => { fakeFile.content = fakeFile.pending; fakeFile.lastModified += 1000; fakeFile.writes++; return Promise.resolve(); } }),
    queryPermission: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted')
  };
  window.showOpenFilePicker = () => Promise.resolve([handle]);
  const r = await FF.storage.pickFile();
  // The behaviour under test needs the live handle, not IndexedDB persistence.
  // Do not await remembering the handle: real IndexedDB I/O can outlive
  // Chrome's virtual-time budget even though the connection is installed
  // synchronously before that background work begins.
  FF.storage.useHandle(r.handle, r.stamp, r.fileName, null);
  await until(() => FF.storage.status().connected, 'the file connection');

  // The file is older than what is on screen. Adopting it automatically would
  // throw away work, so the user has to choose. There used to be a two-second
  // grace window here that silently discarded recent local edits.
  const before = data().cards.length;
  window.FF.app.api.adoptFromFile(JSON.parse(fakeFile.content), 'forefront-data.json');
  await until(() => document.querySelector('.banner--warn'), 'the choice banner');
  eq('the board is untouched', data().cards.length, before);
  ok('and the choice is offered', /newer/i.test(text('.banner__text') || ''));
  const labels = all('.banner .btn').map(b => b.textContent);
  ok('keeping what is on screen is offered', labels.some(l => /Keep what is on screen/.test(l)));
  ok('loading the file is offered', labels.some(l => /Load the file instead/.test(l)));

  click(all('.banner .btn').find(b => /Load the file instead/.test(b.textContent)));
  await until(() => data().cards.length === 1, 'the file to load');
  eq('now showing the file', data().cards[0].title, 'Card that lives in the file');
  ok('and the replaced board is recoverable',
     (FF.storage.readBackup() || '').indexOf('Complete team financial analysis') !== -1);
`));

report('Every documented shortcut works', runPage(example, `
  const shown = () => document.querySelector('.focus') ? 'focus'
                    : document.querySelector('.board') ? 'board' : 'none';
  eq('opens on Focus', shown(), 'focus');

  key(document.body, 'b');
  await until(() => document.querySelector('.board'), 'board via B');
  eq('B opens the board', shown(), 'board');

  key(document.body, 'f');
  await until(() => document.querySelector('.focus'), 'focus via F');
  eq('F returns to Focus', shown(), 'focus');

  key(document.body, 'b');
  await until(() => document.querySelector('.board'), 'board again');
  key(document.body, 'Escape');
  await until(() => document.querySelector('.focus'), 'focus via Escape');
  eq('Escape leaves the board', shown(), 'focus');

  key(document.body, '?');
  const help = await until(() => document.querySelector('.dialog--help'), 'the shortcut list');
  ok('? opens the shortcut list', !!help);
  const listed = Array.from(help.querySelectorAll('kbd')).map(k => k.textContent);
  ok('and it documents Quick Capture', listed.indexOf('N') !== -1);
  escapeDialog(help.closest('dialog'));
  await until(() => !document.querySelector('.dialog--help'), 'help to close');
  ok('Escape closes the shortcut list', !document.querySelector('.dialog--help'));

  key(document.body, 'd');
  const panel = await until(() => document.querySelector('.data-panel'), 'the data panel');
  ok('D opens the Data panel', !!panel);
  escapeDialog(panel.closest('dialog'));
  await until(() => !document.querySelector('.data-panel'), 'panel to close');
  ok('Escape closes it', !document.querySelector('.data-panel'));

  // Single-key shortcuts must not fire while typing.
  key(document.body, 'n');
  const input = await until(() => document.querySelector('.capture__input'), 'capture');
  input.value = 'b';
  key(input, 'b');
  await wait(60);
  ok('typing b in the capture box does not open the board', !document.querySelector('.board'));
  ok('and the capture box is still open', !!document.querySelector('.capture__input'));
`));

report('Finishing and un-finishing', runPage(example, `
  key(document.body, 'b');
  await until(() => document.querySelector('.board'), 'board');

  const card = document.querySelector('.lane--management .card');
  const title = card.querySelector('.card__title').textContent;
  click(card.querySelector('.card__done'));
  await until(() => data().cards.find(c => c.title === title).lane === 'done', 'completion');

  // Done cards cannot be discarded: "this no longer matters" is not a thing you
  // decide about work you already finished.
  const doneCard = Array.from(document.querySelectorAll('.lane--done .card'))
    .find(c => c.querySelector('.card__title').textContent === title);
  click(doneCard.querySelector('.card__menu'));
  const menu = await until(() => document.querySelector('.menu'), 'menu');
  const labels = Array.from(menu.querySelectorAll('.menu__item')).map(b => b.textContent);
  ok('a Done card offers no Discard', labels.indexOf('Discard') === -1);
  ok('but does offer to un-finish it', labels.indexOf('Not finished after all') !== -1);

  click(Array.from(menu.querySelectorAll('.menu__item')).find(b => b.textContent === 'Not finished after all'));
  await until(() => data().cards.find(c => c.title === title).lane !== 'done', 'un-completion');
  const back = data().cards.find(c => c.title === title);
  eq('it goes back where it came from', back.lane, 'management');
  eq('and is no longer completed', back.completedAt, null);

  // A card that was completed, then discarded (only reachable from imported
  // data now), must come back to Done with its completion intact.
  const M = window.FF.model;
  const d2 = data();
  const c2 = M.addCard(d2, 'finished then tidied away', 'projects');
  M.completeCard(d2, c2.id);
  const stamp = M.findCard(d2, c2.id).completedAt;
  M.discardCard(d2, c2.id);
  M.restoreCard(d2, c2.id);
  const revived = M.findCard(d2, c2.id);
  eq('restored to Done', revived.lane, 'done');
  eq('with its completion time intact', revived.completedAt, stamp);
`));

report('A tab left open overnight catches up', runPage(example, `
  eq('shows the day it was opened', text('.focus__date'), new Date(2026, 7, 23).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
  ok('Sunday offers no review', !document.querySelector('.review-prompt'));
  const ageBefore = text('.commitment__age');

  // Midnight passes while the tab sits there. Coming back to it must not show
  // yesterday's date, yesterday's ages, or miss Monday's review entirely.
  window.__setNow('2026-08-24T08:00:00');
  document.dispatchEvent(new Event('visibilitychange'));
  await until(() => /Monday/.test(text('.focus__date') || ''), 'the date to roll over');

  ok('the date has caught up', /Monday, August 24/.test(text('.focus__date')));
  ok('the Monday review is now offered', !!document.querySelector('.review-prompt'));
  ok('and card ages moved on', text('.commitment__age') !== ageBefore);
`, { now: '2026-08-23T21:00:00' }));

report('Persistence across a reload', runPage(example, `
  key(document.body, 'n');
  const input = await until(() => document.querySelector('.capture__input'));
  input.value = 'survives a reload';
  input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(160);
  const stored = JSON.parse(localStorage.getItem('forefront.data.v1'));
  ok('written to storage synchronously', stored.cards.some(c => c.title === 'survives a reload'));
  const reloaded = window.FF.model.validateData(stored);
  ok('what was stored is valid', reloaded.ok);
  eq('and complete', reloaded.data.cards.length, 26);
`));

report('Storage failure is never hidden', runPage(example, `
  // Make writes fail the way a full or blocked storage would.
  const realSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  key(document.body, 'n');
  const input = await until(() => document.querySelector('.capture__input'));
  input.value = 'this cannot be saved';
  input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(200);
  ok('a banner reports the failure', !!document.querySelector('.banner--bad'));
  ok('the message says it was not saved', /not saved|full/i.test(text('.banner__text') || ''));
  ok('the capture dialog stays open with the text still in it',
     !!document.querySelector('.capture__input') && document.querySelector('.capture__input').value === 'this cannot be saved');
  Storage.prototype.setItem = realSet;
`));

report('Accessibility basics', runPage(example, `
  ok('one h1-free semantic structure with headings', all('h2').length > 0);
  ok('every card control has a label',
     (function () { key(document.body, 'b'); return true; })());
  await until(() => document.querySelector('.board'));
  ok('done buttons are labelled', all('.card__done').every(b => (b.getAttribute('aria-label')||'').length > 5));
  ok('menu buttons are labelled', all('.card__menu').every(b => (b.getAttribute('aria-label')||'').length > 5));
  ok('lanes are labelled regions', all('.lane').every(l => !!l.getAttribute('aria-labelledby')));
  ok('cards are keyboard reachable', all('.card').every(c => c.getAttribute('tabindex') === '0'));
  const card = document.querySelector('.card');
  click(card.querySelector('.card__menu'));
  const menu = await until(() => document.querySelector('.menu'));
  eq('menu has the right role', menu.getAttribute('role'), 'menu');
  ok('first item is focused', document.activeElement.getAttribute('role') === 'menuitem');
  key(document.activeElement, 'ArrowDown');
  await wait(40);
  ok('arrow keys move within the menu', document.activeElement.getAttribute('role') === 'menuitem');
  key(document.activeElement, 'Escape');
  await wait(60);
  ok('escape closes the menu', !document.querySelector('.menu'));
  ok('focus returns to the button', document.activeElement.classList.contains('card__menu'));
`));

console.log(fail === 0 ? `\n  ✓ ${pass} browser checks passed\n` : `\n  ${pass} passed, ${fail} FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
