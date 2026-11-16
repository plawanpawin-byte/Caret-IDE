'use strict';
// Updates: looks at the newest GitHub release, downloads the installer, checks its SHA-256 and runs it silently.
// The installer waits for CaretStudio to close, replaces the files and starts the app again. Only GitHub is contacted, nothing about the user is sent.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = 'plawanpawin-byte/Caret-IDE';
const API = process.env.CARET_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`;   // the override is for tests
const ASSET = /^CaretStudio-Setup-[\d.]+\.exe$/;
const MAX_BYTES = 600e6;

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8')).caretVersion || '0.0.0'; } catch { return '0.0.0'; }
}
const parts = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
function newer(a, b) { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }

// GET with redirects (GitHub sends downloads to another host). Calls onChunk for every piece; returns the status.
function get(url, { headers, onChunk, onSize, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' && process.env.CARET_UPDATE_API ? require('http') : https;
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && process.env.CARET_UPDATE_API)) return reject(new Error('Only https is allowed.'));
    const req = lib.get(u, { headers: { 'User-Agent': 'CaretStudio-updater', Accept: '*/*', ...(headers || {}) } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Too many redirects.'));
        return get(new URL(res.headers.location, u).toString(), { headers, onChunk, onSize, redirects: redirects - 1 }).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const size = parseInt(res.headers['content-length'] || '0', 10);
      if (size > MAX_BYTES) { res.resume(); return reject(new Error('The file is too large.')); }
      if (onSize) onSize(size);
      let got = 0;
      res.on('data', d => { got += d.length; if (got > MAX_BYTES) { req.destroy(new Error('The file is too large.')); return; } onChunk(d); });
      res.on('end', () => resolve(res.statusCode));
      res.on('error', reject);
    });
    req.setTimeout(30000, () => req.destroy(new Error('Timed out.')));
    req.on('error', reject);
  });
}
async function getText(url, headers) { const parts = []; await get(url, { headers, onChunk: d => parts.push(d) }); return Buffer.concat(parts).toString('utf8'); }

async function latest() {
  const rel = JSON.parse(await getText(API, { Accept: 'application/vnd.github+json' }));
  if (!rel || !rel.tag_name || rel.draft || rel.prerelease) throw new Error('No release found.');
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const exe = assets.find(a => ASSET.test(a.name));
  const sha = exe && assets.find(a => a.name === exe.name + '.sha256');
  return { version: String(rel.tag_name).replace(/^v/i, ''), page: rel.html_url, exe: exe && exe.browser_download_url, sha: sha && sha.browser_download_url, name: exe && exe.name };
}

async function download(info, report) {
  const dir = path.join(os.tmpdir(), 'CaretStudio-update');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, info.name);
  const want = ((await getText(info.sha)).match(/\b[a-f0-9]{64}\b/i) || [])[0];
  if (!want) throw new Error('The release has no checksum, so it was not installed.');
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(file);
  let total = 0, got = 0, last = 0;
  try {
    await get(info.exe, { onSize: n => { total = n; }, onChunk: d => { hash.update(d); out.write(d); got += d.length; if (total && got - last > total / 50) { report(Math.round((got - last) / total * 100)); last = got; } } });
  } finally { await new Promise(r => out.end(r)); }
  if (hash.digest('hex').toLowerCase() !== want.toLowerCase()) { fs.rmSync(file, { force: true }); throw new Error('The download is damaged (checksum does not match), so it was not installed.'); }
  return file;
}

async function install(info) {
  if (process.platform !== 'win32' || !info.exe || !info.sha) { vscode.env.openExternal(vscode.Uri.parse(info.page || `https://github.com/${REPO}/releases/latest`)); return; }
  let file;
  try {
    file = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Downloading CaretStudio ' + info.version }, async progress => download(info, inc => progress.report({ increment: inc })));
  } catch (e) { vscode.window.showErrorMessage('Update failed: ' + (e.message || e)); return; }
  const child = spawn(file, ['/S', '/UPDATE'], { detached: true, stdio: 'ignore' });
  child.on('error', e => vscode.window.showErrorMessage('Could not start the installer: ' + e.message));
  child.unref();
  vscode.window.showInformationMessage('Updating CaretStudio… it closes and opens again by itself.');
  setTimeout(() => vscode.commands.executeCommand('workbench.action.quit'), 800);
}

const skipped = new Set();
async function check({ manual } = {}) {
  if (!manual && vscode.workspace.getConfiguration('caret').get('autoUpdate') === false) return;
  let info;
  try { info = await latest(); }
  catch (e) { if (manual) vscode.window.showWarningMessage('Could not check for updates: ' + (e.message || e)); return; }
  const cur = version();
  if (!newer(info.version, cur)) { if (manual) vscode.window.showInformationMessage('CaretStudio is up to date (' + cur + ').'); return; }
  if (!manual && skipped.has(info.version)) return;
  const pick = await vscode.window.showInformationMessage(`CaretStudio ${info.version} is available (you have ${cur}).`, 'Update now', 'Later', 'What\'s new');
  if (pick === 'Update now') await install(info);
  else if (pick === 'What\'s new') vscode.env.openExternal(vscode.Uri.parse(info.page || `https://github.com/${REPO}/releases/latest`));
  else skipped.add(info.version);
}

function start(ctx) {
  const t1 = setTimeout(() => check(), 30000);
  const t2 = setInterval(() => check(), 6 * 3600 * 1000);
  ctx.subscriptions.push({ dispose() { clearTimeout(t1); clearInterval(t2); } });
}

function feedback() {
  const body = '**What happened?**\n\n\n**What did you expect?**\n\n\n---\nCaretStudio ' + version() + ' · ' + process.platform + ' ' + os.release();
  vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${REPO}/issues/new?body=${encodeURIComponent(body)}`));
}

module.exports = { start, check, version, feedback, newer };
