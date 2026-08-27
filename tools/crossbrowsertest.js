#!/usr/bin/env node
/**
 * Cross-browser smoke test through the W3C WebDriver protocol, with no npm
 * dependencies. Firefox runs headless; Safari uses its normal WebDriver window.
 *
 *   node tools/crossbrowsertest.js firefox
 *   node tools/crossbrowsertest.js safari
 *
 * On macOS, Safari automation must be enabled once with `safaridriver --enable`.
 */
'use strict';

const http = require('http');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { start } = require('./serve.js');

const browser = (process.argv[2] || 'firefox').toLowerCase();
if (!['firefox', 'safari'].includes(browser)) {
  console.error('Usage: node tools/crossbrowsertest.js <firefox|safari>');
  process.exit(2);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function request(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const json = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: route,
      headers: json ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) } : {}
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : {}; } catch (e) { return reject(new Error(text)); }
        if (res.statusCode >= 400) return reject(new Error(JSON.stringify(parsed)));
        resolve(parsed.value === undefined ? parsed : parsed.value);
      });
    });
    req.on('error', reject);
    if (json) req.write(json);
    req.end();
  });
}

async function until(fn, label, timeout = 15000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ''}`);
}

function driverCommand(port) {
  // Snap-packaged Firefox moves geckodriver into a confinement domain that its
  // Node parent cannot always signal afterwards. `timeout` owns that confined
  // process and guarantees cleanup even in that environment. Regular macOS and
  // Linux Firefox installations do not need this workaround.
  if (browser === 'firefox' && process.platform === 'linux' &&
      spawnSync('which', ['timeout'], { stdio: 'ignore' }).status === 0) {
    return { command: 'timeout', args: ['90', 'geckodriver', '--port', String(port)], timed: true };
  }
  if (browser === 'firefox') return { command: 'geckodriver', args: ['--port', String(port)], timed: false };
  return { command: 'safaridriver', args: ['-p', String(port)], timed: false };
}

function capabilities() {
  if (browser === 'firefox') {
    return { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } } };
  }
  return { alwaysMatch: { browserName: 'safari' } };
}

const smokeScript = `
  const done = arguments[arguments.length - 1];
  const results = [];
  const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, label) => {
    const started = Date.now();
    while (Date.now() - started < 5000) {
      let value = null; try { value = fn(); } catch (e) {}
      if (value) return value;
      await wait(30);
    }
    throw new Error('timed out waiting for ' + label);
  };

  (async () => {
    try {
      await until(() => document.querySelector('.focus'), 'Focus');
      const empty = FF.model.createEmptyData();
      FF.app.api.adoptImported(empty);
      ok('boots on Focus', !!document.querySelector('.focus'));
      ok('browser storage is available', FF.storage.status().caps.localStorage);

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }));
      const input = await until(() => document.querySelector('.capture__input'), 'Quick Capture');
      input.value = 'Cross-browser capture';
      input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await until(() => !document.querySelector('.capture__input'), 'capture to close');
      ok('Quick Capture saves to Inbox', FF.app.api.getData().cards.some(card => card.title === 'Cross-browser capture' && card.lane === 'inbox'));
      ok('capture persists in localStorage', JSON.parse(localStorage.getItem(FF.C.LS_KEY)).cards.some(card => card.title === 'Cross-browser capture'));

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true }));
      await until(() => document.querySelector('.board'), 'Board');
      ok('Board opens', !!document.querySelector('.board'));
      ok('all five working lanes render', document.querySelectorAll('.lane').length === 5);
      ok('captured card renders literally', Array.from(document.querySelectorAll('.card__title')).some(node => node.textContent === 'Cross-browser capture'));

      FF.app.actions.openData();
      const panel = await until(() => document.querySelector('.data-panel'), 'Data panel');
      ok('Data panel opens', !!panel);
      ok('Export is available', Array.from(panel.querySelectorAll('button')).some(button => /Download JSON/.test(button.textContent)));
      ok('Import is available', Array.from(panel.querySelectorAll('button')).some(button => /Choose a file/.test(button.textContent)));
      panel.closest('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    } catch (error) {
      results.push({ name: 'smoke test completed', pass: false, detail: String(error && error.stack || error) });
    }
    done(results);
  })();
`;

async function main() {
  const driverPort = await freePort();
  const web = await start({ port: 0, quiet: true });
  const driver = driverCommand(driverPort);
  const required = browser === 'firefox' ? 'geckodriver' : 'safaridriver';
  if (spawnSync('which', [required], { stdio: 'ignore' }).status !== 0) {
    throw new Error(`${required} is not installed`);
  }

  const child = spawn(driver.command, driver.args, { stdio: 'ignore' });
  let sessionId = null;

  try {
    await until(() => request(driverPort, 'GET', '/status').then(() => true), `${driver.command} to start`);
    const session = await request(driverPort, 'POST', '/session', { capabilities: capabilities() });
    sessionId = session.sessionId;
    if (!sessionId) throw new Error('WebDriver did not return a session id');

    const base = `/session/${sessionId}`;
    await request(driverPort, 'POST', `${base}/url`, { url: web.url });
    await until(() => request(driverPort, 'POST', `${base}/execute/sync`, {
      script: 'return !!window.FF && !!document.querySelector(".focus")', args: []
    }), 'Forefront to boot');

    const results = await request(driverPort, 'POST', `${base}/execute/async`, {
      script: smokeScript, args: []
    });

    // A reload is the meaningful persistence boundary for every supported
    // browser; the captured card must come back from browser storage.
    await request(driverPort, 'POST', `${base}/url`, { url: web.url });
    const restored = await until(() => request(driverPort, 'POST', `${base}/execute/sync`, {
      script: 'return !!window.FF && FF.app.api.getData().cards.some(function(card){ return card.title === "Cross-browser capture"; })', args: []
    }), 'the captured card after reload');
    results.push({ name: 'data survives a reload', pass: !!restored, detail: '' });

    let failed = 0;
    console.log(`\n${browser[0].toUpperCase() + browser.slice(1)} on localhost`);
    results.forEach(result => {
      if (result.pass) console.log(`  ok    ${result.name}`);
      else { failed++; console.error(`  FAIL  ${result.name}${result.detail ? `\n        ${result.detail}` : ''}`); }
    });
    console.log(failed ? `\n  ${results.length - failed} passed, ${failed} FAILED\n` : `\n  ✓ ${results.length} cross-browser checks passed\n`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    if (sessionId) await request(driverPort, 'DELETE', `/session/${sessionId}`).catch(() => {});
    if (driver.timed) {
      // Do not wait for the Linux timeout wrapper's safety deadline.
      child.unref();
    } else {
      try { child.kill('SIGTERM'); } catch (e) {}
    }
    web.server.close();
  }
}

main().catch(error => {
  console.error(`Cross-browser test failed: ${error.message}`);
  if (browser === 'safari') console.error('On macOS, run `safaridriver --enable` once and approve automation when prompted.');
  process.exitCode = 1;
});
