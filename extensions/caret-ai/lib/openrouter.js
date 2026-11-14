'use strict';
// OpenRouter: sign-in (OAuth PKCE, the user gets their OWN key), the model list, and streaming chat with tool calls.
// The user pays for their own use with their own OpenRouter credits. Nothing here holds a key of ours.
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const HOST = 'openrouter.ai';
const CREDITS_URL = 'https://openrouter.ai/settings/credits';

function request(method, path, body, headers, onData, signal) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({ host: HOST, path, method, headers: { 'Content-Type': 'application/json', 'X-Title': 'Caret IDE', 'HTTP-Referer': 'https://github.com/plawanpawin-byte', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...(headers || {}) } }, res => {
      if (onData && res.statusCode === 200) { res.setEncoding('utf8'); res.on('data', onData); res.on('end', () => resolve({ status: 200 })); res.on('error', reject); return; }
      let out = ''; res.setEncoding('utf8'); res.on('data', d => { out += d; }); res.on('end', () => resolve({ status: res.statusCode, text: out }));
    });
    req.on('error', reject);
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    if (data) req.write(data);
    req.end();
  });
}

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Opens the browser at OpenRouter, waits for the redirect to a temporary local page, trades the code for the user's key.
// openUrl(url) is given by the caller (vscode.env.openExternal).
function signIn(openUrl) {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(12));
    let done = false;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname !== '/callback') { res.statusCode = 404; res.end(); return; }
      const code = u.searchParams.get('code');
      const page = msg => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><meta charset="utf-8"><title>Caret IDE</title><body style="font:16px system-ui;background:#0b0b0b;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div>' + msg + '</div>'); };
      if (!code || u.searchParams.get('state') !== state) { page('Sign-in was not completed. You can close this tab.'); finish(new Error('Sign-in was cancelled.')); return; }
      try {
        const r = await request('POST', '/api/v1/auth/keys', { code, code_verifier: verifier, code_challenge_method: 'S256' });
        const j = JSON.parse(r.text || '{}');
        if (r.status !== 200 || !j.key) throw new Error('OpenRouter did not give a key (' + r.status + ').');
        page('Signed in. You can close this tab and go back to Caret IDE.');
        finish(null, j.key);
      } catch (e) { page('Sign-in failed. You can close this tab.'); finish(e); }
    });
    const timer = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), 5 * 60 * 1000);
    function finish(err, key) { if (done) return; done = true; clearTimeout(timer); try { server.close(); } catch {} err ? reject(err) : resolve(key); }
    server.on('error', e => finish(e));
    server.listen(0, 'localhost', () => {
      const cb = 'http://localhost:' + server.address().port + '/callback';
      openUrl('https://' + HOST + '/auth?callback_url=' + encodeURIComponent(cb) + '&code_challenge=' + challenge + '&code_challenge_method=S256&state=' + state + '&key_label=' + encodeURIComponent('Caret IDE'));
    });
  });
}

// The list for the model menu: every free model that can call tools, and the newest few models of the well-known makers.
const MAKERS = ['anthropic', 'openai', 'google', 'deepseek', 'qwen', 'moonshotai', 'z-ai', 'x-ai', 'mistralai'];
let cached = null;
async function models() {
  if (cached && Date.now() - cached.at < 3600e3) return cached.list;
  const r = await request('GET', '/api/v1/models');
  if (r.status !== 200) throw new Error('Could not load the model list (' + r.status + ').');
  const all = (JSON.parse(r.text).data || []).filter(m => (m.supported_parameters || []).includes('tools') && ((m.architecture || {}).output_modalities || ['text']).join() === 'text' && !/:(batch|extended|thinking)$/.test(m.id));
  const price = m => { const p = +m.pricing.prompt * 1e6, c = +m.pricing.completion * 1e6; return (m.id.endsWith(':free') || (p === 0 && c === 0)) ? 'Free' : '$' + p.toFixed(2) + ' / $' + c.toFixed(2) + ' per 1M tokens'; };
  const entry = m => ({ id: 'or:' + m.id, label: m.name.replace(/^[^:]+:\s*/, '').replace(/\s*\(free\)$/i, ''), tool: 'openrouter', model: m.id, desc: price(m), free: price(m) === 'Free', ctx: m.context_length || 32768, group: m.id.split('/')[0] });
  const free = all.filter(m => price(m) === 'Free').sort((a, b) => b.created - a.created).slice(0, 12).map(entry);
  const paid = [];
  for (const mk of MAKERS) paid.push(...all.filter(m => m.id.startsWith(mk + '/') && price(m) !== 'Free').sort((a, b) => b.created - a.created).slice(0, 2).map(entry));
  const list = [...free, ...paid];
  cached = { at: Date.now(), list };
  return list;
}

function parseArgs(a) {
  if (a && typeof a === 'object') return a;
  try { return JSON.parse(a || '{}') || {}; } catch { return {}; }
}

function toWire(messages) {
  return messages.map(m => {
    if (m.role === 'assistant' && m.tool_calls) return { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls.map(c => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments || {}) } })) };
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
    return { role: m.role, content: m.content };
  });
}

function explain(status, text) {
  let msg = ''; try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || ''; } catch {}
  if (status === 401) return 'OpenRouter did not accept the sign-in. Sign in again.';
  if (status === 402) return 'This model needs credits. Add credits at ' + CREDITS_URL + ' or pick a Free model.';
  if (status === 429) return 'This model is busy or you reached its limit for now. Wait a moment, or pick another model. ' + (msg ? '(' + String(msg).slice(0, 160) + ')' : '');
  return 'OpenRouter error ' + status + (msg ? ': ' + String(msg).slice(0, 200) : '');
}

// Streams one answer. Returns { content, calls:[{id, function:{name, arguments:string}}] }.
async function chat({ key, model, messages, tools, signal, onEvent }) {
  if (!key) throw new Error('Not signed in to OpenRouter.');
  const body = { model, messages: toWire(messages), stream: true };
  if (tools && tools.length) body.tools = tools;
  let buf = '', content = '', err = null;
  const acc = [];
  const take = line => {
    if (!line.startsWith('data:')) return;
    const d = line.slice(5).trim();
    if (!d || d === '[DONE]') return;
    let j; try { j = JSON.parse(d); } catch { return; }
    if (j.error) { err = j.error.message || 'The model stopped with an error.'; return; }
    const delta = (j.choices && j.choices[0] && j.choices[0].delta) || {};
    if (delta.content) { content += delta.content; onEvent && onEvent({ type: 'text', text: delta.content }); }
    const th = delta.reasoning || delta.reasoning_content; if (th) onEvent && onEvent({ type: 'thinking', text: th });
    for (const tc of delta.tool_calls || []) {
      const i = tc.index == null ? acc.length : tc.index;
      const c = acc[i] || (acc[i] = { id: '', function: { name: '', arguments: '' } });
      if (tc.id) c.id = tc.id;
      if (tc.function && tc.function.name) c.function.name += tc.function.name;
      if (tc.function && tc.function.arguments) c.function.arguments += tc.function.arguments;
    }
  };
  const r = await request('POST', '/api/v1/chat/completions', body, { Authorization: 'Bearer ' + key }, chunk => { buf += chunk; let n; while ((n = buf.indexOf('\n')) >= 0) { take(buf.slice(0, n).replace(/\r$/, '')); buf = buf.slice(n + 1); } }, signal);
  if (buf) take(buf);
  if (r.status !== 200) throw new Error(explain(r.status, r.text));
  if (err) throw new Error(String(err).slice(0, 300));
  const calls = acc.filter(c => c && c.function.name).map((c, i) => ({ id: c.id || 'call_' + Date.now().toString(36) + i, function: c.function }));
  return { content, calls };
}

module.exports = { signIn, models, chat, parseArgs, explain, CREDITS_URL };
