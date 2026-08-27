#!/usr/bin/env node
/**
 * Forefront's no-dependency local server.
 *
 * Localhost is the common supported launch mode for Chrome, Firefox and Safari:
 * it gives each browser a normal, private origin for browser storage without
 * sending anything off the machine. Run: node tools/serve.js --open
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function safePath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (e) { return null; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(ROOT, relative);
  return resolved === ROOT || resolved.startsWith(ROOT + path.sep) ? resolved : null;
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end('Method not allowed');
    }

    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const file = safePath(pathname);
    if (!file) { res.writeHead(400); return res.end('Bad request'); }

    fs.stat(file, (statError, stat) => {
      if (statError || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }

      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  });
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function start(options = {}) {
  const server = createServer();
  const host = options.host || '127.0.0.1';
  const port = options.port === undefined ? 8765 : options.port;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const url = `http://${host}:${address.port}/`;
      if (!options.quiet) {
        console.log(`Forefront is running at ${url}`);
        console.log('Keep this window open. Press Ctrl+C to stop.');
      }
      if (options.open) openBrowser(url);
      resolve({ server, url });
    });
  });
}

function argumentValue(name, fallback) {
  const at = process.argv.indexOf(name);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

if (require.main === module) {
  const port = Number(argumentValue('--port', '8765'));
  start({ port: Number.isFinite(port) ? port : 8765, open: process.argv.includes('--open') })
    .catch(error => {
      console.error(`Could not start Forefront: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { createServer, start };
