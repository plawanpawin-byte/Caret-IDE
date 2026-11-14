'use strict';
// Talks to Ollama on this computer: is it there, start it, install it, download a model, make the Aeble names, and stream a chat.
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const cli = require('./cli');
const aeble = require('./aeble');

// OLLAMA_HOST (host:port) is Ollama's own setting; it also lets the tests talk to a second Ollama on another port.
const BASE = (() => { const m = /^(?:https?:\/\/)?([^:\/]+)?(?::(\d+))?/.exec(process.env.OLLAMA_HOST || ''); return { host: (m && m[1]) || '127.0.0.1', port: Number((m && m[2]) || 11434) }; })();

// Plain http on purpose: fetch() gives up after 5 minutes of silence, which a slow computer reading a long prompt can exceed.
function request(method, urlPath, body, { onLine, signal, timeout } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ ...BASE, path: urlPath, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, res => {
      res.setEncoding('utf8');
      let buf = '', all = '';
      res.on('data', d => {
        if (!onLine) { all += d; return; }
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); }
      });
      res.on('end', () => { if (onLine && buf.trim()) onLine(buf.trim()); resolve({ status: res.statusCode, text: all }); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout || 0, () => req.destroy(new Error('timeout')));
    if (signal) { const stop = () => req.destroy(new Error('aborted')); if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }
    if (data) req.write(data);
    req.end();
  });
}

async function tags() {
  try {
    const r = await request('GET', '/api/tags', null, { timeout: 2500 });
    if (r.status !== 200) return null;
    return (JSON.parse(r.text).models || []).map(m => m.name);
  } catch { return null; }
}
const has = (list, name) => !!list && list.some(n => n === name || n === name + ':latest');

async function status() {
  const list = await tags();
  return { installed: !!cli.findOllama(), running: list !== null, models: list || [] };
}

async function ensureServer() {
  if (await tags()) return;
  const exe = cli.findOllama();
  if (!exe) throw new Error('Ollama is not installed.');
  spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 500)); if (await tags()) return; }
  throw new Error('Ollama did not start.');
}

function modelsDir() { return process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models'); }
function freeGB() {
  let dir = modelsDir();
  while (dir && !fs.existsSync(dir)) { const up = path.dirname(dir); if (up === dir) break; dir = up; }
  try { const s = fs.statfsSync(dir); return (s.bavail * s.bsize) / 2 ** 30; } catch { return Infinity; }
}

function download(url, file, onPct, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error('Too many redirects.'));
    https.get(url, { headers: { 'user-agent': 'caret-ide' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(download(new URL(res.headers.location, url).toString(), file, onPct, hops + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('Download failed (' + res.statusCode + ').')); }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      const out = fs.createWriteStream(file);
      res.on('data', d => { got += d.length; if (total) onPct(Math.round(got / total * 100)); });
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject); res.on('error', reject);
    }).on('error', reject);
  });
}

// Official installer from ollama.com, per-user (no administrator). Its signature is checked before it runs.
async function install(report) {
  if (process.platform !== 'win32') throw new Error('Install Ollama from https://ollama.com/download and try again.');
  const file = path.join(os.tmpdir(), 'OllamaSetup.exe');
  report({ text: 'Downloading Ollama', pct: 0 });
  await download('https://ollama.com/download/OllamaSetup.exe', file, pct => report({ text: 'Downloading Ollama', pct }));
  const sig = await new Promise(res => execFile('powershell.exe', ['-NoProfile', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${file}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`], { windowsHide: true }, (e, out) => res(String(out || '').trim())));
  if (!/^Valid\|.*Ollama/i.test(sig)) { try { fs.unlinkSync(file); } catch {} throw new Error('The Ollama installer did not pass the signature check, so it was not run.'); }
  report({ text: 'Installing Ollama', pct: null });
  await new Promise((res, rej) => execFile(file, ['/SILENT', '/NORESTART'], { windowsHide: true }, e => (e ? rej(e) : res())));
  try { fs.unlinkSync(file); } catch {}
  cli.clearCache(); cli.fixPath();
  if (!cli.findOllama()) throw new Error('Ollama did not install.');
}

async function pull(name, report) {
  let err = null;
  await request('POST', '/api/pull', { model: name, stream: true }, {
    onLine: l => {
      let j; try { j = JSON.parse(l); } catch { return; }
      if (j.error) err = j.error;
      else if (j.total) report({ text: 'Downloading ' + name, pct: Math.round((j.completed || 0) / j.total * 100) });
      else if (j.status) report({ text: j.status, pct: null });
    },
  });
  if (err) throw new Error(err);
}

// "aeble-2.5" is a small layer on top of the base model: same weights, plus Caret's instructions and settings.
async function createAlias(spec, report) {
  let err = null;
  report({ text: 'Preparing ' + spec.label, pct: null });
  await request('POST', '/api/create', { model: spec.id, from: spec.base, system: aeble.SYSTEM, parameters: { num_ctx: spec.ctx, temperature: 0.2 }, stream: true }, {
    onLine: l => { try { const j = JSON.parse(l); if (j.error) err = j.error; } catch {} },
  });
  if (err) throw new Error(err);
}

// Everything the first start needs: Ollama, the base model, the Aeble name. Skips what is already there.
async function setup(spec, report) {
  report({ text: 'Checking Ollama', pct: null });
  if (!cli.findOllama()) await install(report);
  await ensureServer();
  let list = await tags();
  if (!has(list, spec.base)) {
    const need = spec.sizeGB * 1.1, free = freeGB();
    if (free < need) throw new Error(`Not enough disk space for ${spec.label}: it needs about ${need.toFixed(1)} GB free and ${free.toFixed(1)} GB is free where Ollama keeps its models (${modelsDir()}).`);
    await pull(spec.base, report);
    list = await tags();
  }
  if (!has(list, spec.id)) await createAlias(spec, report);
  report({ text: spec.label + ' is ready', pct: 100 });
}

// Splits <think>…</think> that some models put inside normal text.
function thinkSplitter() {
  let inThink = false, carry = '';
  return chunk => {
    const out = [];
    let s = carry + chunk; carry = '';
    while (s) {
      const tag = inThink ? '</think>' : '<think>';
      const i = s.indexOf(tag);
      if (i < 0) {
        let keep = 0;
        for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (tag.startsWith(s.slice(-k))) { keep = k; break; }
        const body = s.slice(0, s.length - keep);
        if (body) out.push({ type: inThink ? 'thinking' : 'text', text: body });
        carry = s.slice(s.length - keep);
        break;
      }
      if (i > 0) out.push({ type: inThink ? 'thinking' : 'text', text: s.slice(0, i) });
      s = s.slice(i + tag.length); inThink = !inThink;
    }
    return out;
  };
}

const parseArgs = v => { if (v && typeof v === 'object') return v; try { return JSON.parse(v || '{}'); } catch { return {}; } };

function toOllamaMessages(messages) {
  return messages.map(m => {
    if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.name };
    const out = { role: m.role, content: m.content || '' };
    if (m.tool_calls) out.tool_calls = m.tool_calls.map(tc => ({ function: { name: tc.function.name, arguments: parseArgs(tc.function.arguments) } }));
    return out;
  });
}

// Small models often write the tool call as plain text (```json {"name":..., "arguments":{...}} ``` or a bare JSON object)
// instead of Ollama's <tool_call> tags. Find those and turn them into real calls.
function extractCalls(content, names) {
  const calls = [];
  let rest = content;
  const take = (raw, whole) => {
    let j; try { j = JSON.parse(raw); } catch { return false; }
    const list = Array.isArray(j) ? j : [j];
    const ok = list.filter(x => x && typeof x.name === 'string' && names.includes(x.name) && (x.arguments === undefined || typeof x.arguments === 'object' || typeof x.arguments === 'string'));
    if (!ok.length || ok.length !== list.length) return false;
    for (const x of ok) calls.push({ id: 'call_' + Math.random().toString(36).slice(2, 10), type: 'function', function: { name: x.name, arguments: JSON.stringify(parseArgs(x.arguments)) } });
    rest = rest.replace(whole, '');
    return true;
  };
  for (const m of [...content.matchAll(/```(?:json|tool_call)?\s*([\s\S]*?)```/g)]) take(m[1].trim(), m[0]);
  for (const m of [...content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)]) take(m[1].trim(), m[0]);
  if (!calls.length) { const t = content.trim(); if (/^[\[{]/.test(t)) take(t, content); }
  return { calls, rest: rest.trim() };
}

// One model turn. onEvent gets {type:'text'|'thinking', text}; resolves with { content, calls }.
async function chat({ model, messages, tools, numCtx, think, signal, onEvent }) {
  const split = thinkSplitter();
  const calls = [];
  let content = '', err = null, held = null;   // held: text that may be a tool call written as text, shown only if it is not one
  const names = (tools || []).map(t => t.function.name);
  const body = { model, messages: toOllamaMessages(messages), tools: tools && tools.length ? tools : undefined, stream: true, think, keep_alive: '30m', options: { num_ctx: numCtx } };
  const r = await request('POST', '/api/chat', body, {
    signal,
    onLine: l => {
      let j; try { j = JSON.parse(l); } catch { return; }
      if (j.error) { err = j.error; return; }
      const msg = j.message || {};
      if (msg.thinking) onEvent({ type: 'thinking', text: msg.thinking });
      if (msg.content) for (const ev of split(msg.content)) {
        if (ev.type !== 'text') { onEvent(ev); continue; }
        content += ev.text;
        if (held === null && /^\s*[`{\[<]/.test(content) && names.length) held = '';
        if (held !== null) held += ev.text; else onEvent(ev);
      }
      for (const tc of msg.tool_calls || []) calls.push({ id: 'call_' + Math.random().toString(36).slice(2, 10), type: 'function', function: { name: tc.function?.name, arguments: JSON.stringify(tc.function?.arguments ?? {}) } });
    },
  });
  if (!err && !calls.length && names.length && content.trim()) {
    const x = extractCalls(content, names);
    if (x.calls.length) { calls.push(...x.calls); content = x.rest; held = x.rest ? x.rest : null; if (held) { onEvent({ type: 'text', text: held }); held = null; } }
  }
  if (held) onEvent({ type: 'text', text: held });
  if (!err && r.status && r.status !== 200) err = 'Ollama answered ' + r.status;
  if (err) {
    if (think !== undefined && /think/i.test(err)) return chat({ model, messages, tools, numCtx, think: undefined, signal, onEvent });
    throw new Error(err);
  }
  return { content, calls };
}

module.exports = { extractCalls, status, ensureServer, setup, chat, tags, has, parseArgs, modelsDir, freeGB };
