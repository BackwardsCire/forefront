/**
 * Dev-only: a minimal Chrome DevTools Protocol client — enough to evaluate
 * JavaScript in a real page on a real clock.
 *
 * It exists because headless Chrome's --virtual-time-budget fast-forwards
 * timers in microseconds of real time, which makes anything backed by real I/O
 * (IndexedDB, the File System Access API) look like it hangs when it is merely
 * slower than an instant. Measuring those needs a wall clock.
 *
 * Node 20 has no WebSocket client, so the handshake and framing are here. Not
 * a general implementation — just what these tests need.
 */
'use strict';
const net = require('net');
const http = require('http');
const crypto = require('crypto');

function httpJSON(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function connect(wsUrl) {
  const u = new URL(wsUrl);
  const key = crypto.randomBytes(16).toString('base64');

  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(u.port), u.hostname, () => {
      sock.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    sock.on('error', reject);

    let buf = Buffer.alloc(0);
    let open = false;
    const waiters = new Map();
    let nextId = 1;

    function send(method, params) {
      const id = nextId++;
      const payload = Buffer.from(JSON.stringify({ id, method, params: params || {} }));
      const mask = crypto.randomBytes(4);
      const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));

      let header;
      if (payload.length < 126) {
        header = Buffer.from([0x81, 0x80 | payload.length]);
      } else if (payload.length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81; header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81; header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
      }
      sock.write(Buffer.concat([header, mask, masked]));
      return new Promise((res, rej) => waiters.set(id, { res, rej }));
    }

    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);

      if (!open) {
        const end = buf.indexOf('\r\n\r\n');
        if (end === -1) return;
        const head = buf.slice(0, end).toString();
        if (!/101/.test(head)) return reject(new Error('handshake failed: ' + head.split('\r\n')[0]));
        buf = buf.slice(end + 4);
        open = true;
        resolve({ send, close: () => sock.destroy() });
      }

      // Decode as many complete server frames as the buffer holds.
      for (;;) {
        if (buf.length < 2) return;
        const len0 = buf[1] & 0x7f;
        let offset = 2, length = len0;
        if (len0 === 126) { if (buf.length < 4) return; length = buf.readUInt16BE(2); offset = 4; }
        else if (len0 === 127) { if (buf.length < 10) return; length = Number(buf.readBigUInt64BE(2)); offset = 10; }
        if (buf.length < offset + length) return;

        const payload = buf.slice(offset, offset + length).toString();
        buf = buf.slice(offset + length);

        let msg; try { msg = JSON.parse(payload); } catch (e) { continue; }
        if (msg.id && waiters.has(msg.id)) {
          const w = waiters.get(msg.id);
          waiters.delete(msg.id);
          msg.error ? w.rej(new Error(JSON.stringify(msg.error))) : w.res(msg.result);
        }
      }
    });
  });
}

/** Open `url` in a real Chrome, evaluate `expression`, return its value. */
async function evaluateInPage(chromeBin, url, expression, opts = {}) {
  const { execFile } = require('child_process');
  const fs = require('fs'), os = require('os'), path = require('path');
  const port = opts.port || (9200 + Math.floor(Number(process.env.CDP_PORT_OFFSET || 0)));
  // A caller can supply a profile directory to keep storage across launches,
  // which is how "do two local files share one storage area" gets tested.
  const profile = opts.profile || fs.mkdtempSync(path.join(os.tmpdir(), 'ff-cdp-'));

  const child = execFile(chromeBin, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--window-size=1440,900', url
  ]);

  try {
    let targets = null;
    for (let i = 0; i < 100 && !targets; i++) {
      await new Promise(r => setTimeout(r, 100));
      try {
        const list = await httpJSON(port, '/json/list');
        targets = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (!targets.length) targets = null;
      } catch (e) { /* not up yet */ }
    }
    if (!targets) throw new Error('Chrome did not expose a page target');

    const ws = await connect(targets[0].webSocketDebuggerUrl);
    await new Promise(r => setTimeout(r, opts.settle || 600));
    const res = await ws.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    });
    ws.close();
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 400));
    return res.result && res.result.value;
  } finally {
    child.kill('SIGKILL');
    if (!opts.profile) fs.rmSync(profile, { recursive: true, force: true });
  }
}

module.exports = { evaluateInPage };
