#!/usr/bin/env node
/**
 * Dev-only: render Forefront to PNGs so the design can be looked at.
 * Usage: node tools/screenshot.js <outdir>
 *
 * Note: headless Chrome has no pointing device, so it matches
 * `@media (hover: none)` and the per-card done/menu controls render visible.
 * On a desktop with a mouse they stay hidden until hover. The screenshots show
 * the touch variant, not the everyday one.
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const outDir = process.argv[2] || path.join(os.tmpdir(), 'forefront-shots');
fs.mkdirSync(outDir, { recursive: true });
const example = fs.readFileSync(path.join(root, 'sample-data', 'example.json'), 'utf8');

const SHOTS = [
  { name: 'focus',        w: 1920, h: 1080, setup: '' },
  { name: 'focus-laptop', w: 1440, h: 900,  setup: '' },
  { name: 'board',        w: 1920, h: 1080, setup: `key(document.body,'b'); await until(()=>document.querySelector('.board'));` },
  { name: 'board-laptop', w: 1440, h: 900,  setup: `key(document.body,'b'); await until(()=>document.querySelector('.board'));` },
  { name: 'capture',      w: 1920, h: 1080, setup: `key(document.body,'n'); await until(()=>document.querySelector('.capture__input'));
      document.querySelector('.capture__input').value='Ask Mike whether contractor extensions are in Q4 funding';` },
  { name: 'review',       w: 1920, h: 1080, now: '2026-08-24T08:00:00', setup: '' },
  { name: 'review-rail',  w: 1920, h: 1080, now: '2026-08-24T08:00:00',
    setup: `click(document.querySelectorAll('.review-prompt__actions .btn')[0]); await until(()=>document.querySelector('.rail'));` },
  { name: 'data-panel',   w: 1920, h: 1080, setup: `key(document.body,'d'); await until(()=>document.querySelector('.data-panel'));` },
  { name: 'focus-empty',  w: 1920, h: 1080, empty: true, setup: '' },
];

for (const shot of SHOTS) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-shot-'));
  const seed = `<script>
    try { localStorage.clear(); ${shot.empty ? '' : `localStorage.setItem('forefront.data.v1', ${JSON.stringify(example)});`} } catch(e){}
    ${shot.now ? `(function(){var F=new Date(${JSON.stringify(shot.now)}).getTime(),R=Date;
      function D(...a){if(!(this instanceof D))return new R(F).toString();return a.length?new R(...a):new R(F);}
      D.prototype=R.prototype;D.now=()=>F;D.parse=R.parse;D.UTC=R.UTC;window.Date=D;})();` : ''}
  </script>`;
  const drive = `<script>
    function key(el,k,i){el.dispatchEvent(new KeyboardEvent('keydown',Object.assign({key:k,bubbles:true,cancelable:true},i||{})));}
    function click(el){el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));}
    function until(fn,ms){ms=ms||4000;const s=Date.now();return new Promise((res,rej)=>{(function p(){let v;try{v=fn()}catch(e){v=null}
      if(v)return res(v);if(Date.now()-s>ms)return rej(new Error('timeout'));setTimeout(p,20)})()})}
    (async function(){ await until(()=>document.querySelector('#app .focus, #app .board')); ${shot.setup} })();
  </script>`;

  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('<meta charset="utf-8">', '<meta charset="utf-8">' + seed)
    .replace('</body>', drive + '</body>');
  const file = path.join(root, '_shot.tmp.html');
  fs.writeFileSync(file, page);
  const out = path.join(outDir, shot.name + '.png');
  try {
    execFileSync('google-chrome', ['--headless=new','--no-sandbox','--disable-gpu',
      `--user-data-dir=${profile}`, '--hide-scrollbars',
      `--window-size=${shot.w},${shot.h}`, '--virtual-time-budget=20000',
      `--screenshot=${out}`, 'file://' + file], { stdio: 'pipe' });
    console.log('  ' + shot.name + '.png  ' + shot.w + 'x' + shot.h);
  } catch (e) { console.error('  FAILED ' + shot.name + ': ' + e.message.slice(0,200)); }
  finally { fs.unlinkSync(file); fs.rmSync(profile, { recursive: true, force: true }); }
}
console.log('\nWrote to ' + outDir);
