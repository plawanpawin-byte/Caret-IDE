'use strict';
// OpenRouter: the user pastes THEIR OWN API key (made at openrouter.ai/keys) and pays for use from their own credits.
// This file checks the key, loads the model list and streams chat answers with tool calls. No key of ours is involved.
const https = require('https');

const HOST = 'openrouter.ai';
const CREDITS_URL = 'https://openrouter.ai/settings/credits';
const KEYS_URL = 'https://openrouter.ai/settings/keys';

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

// Is this key accepted? Returns { ok, error }.
async function checkKey(key) {
  key = String(key || '').trim();
  if (!/^sk-or-[\w-]{8,}$/.test(key)) return { ok: false, error: 'That does not look like an OpenRouter key. It starts with sk-or-.' };
  try {
    const r = await request('GET', '/api/v1/key', null, { Authorization: 'Bearer ' + key });
    if (r.status === 200) return { ok: true };
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'OpenRouter did not accept this key. Check that you copied all of it.' };
    return { ok: false, error: 'OpenRouter answered with an error (' + r.status + '). Try again in a moment.' };
  } catch { return { ok: false, error: 'Could not reach OpenRouter. Check your internet connection.' }; }
}

// Every paid model that can call tools. "popular" marks the newest few of Claude, GPT and Gemini: those are on by default.
const MAKERS = ['anthropic', 'openai', 'google'];
let cached = null;
async function catalog() {
  if (cached && Date.now() - cached.at < 3600e3) return cached.list;
  const r = await request('GET', '/api/v1/models');
  if (r.status !== 200) throw new Error('Could not load the model list (' + r.status + ').');
  const cost = m => +m.pricing.prompt * 1e6 + 4 * (+m.pricing.completion * 1e6);
  const all = (JSON.parse(r.text).data || []).filter(m => (m.supported_parameters || []).includes('tools') && ((m.architecture || {}).output_modalities || ['text']).join() === 'text' && !/:(batch|extended|thinking|free)$/.test(m.id) && cost(m) > 0);
  const price = m => '$' + (+m.pricing.prompt * 1e6).toFixed(2) + ' in / $' + (+m.pricing.completion * 1e6).toFixed(2) + ' out per 1M tokens';
  const popular = new Set();
  for (const mk of MAKERS) all.filter(m => m.id.startsWith(mk + '/')).sort((a, b) => b.created - a.created).slice(0, 3).forEach(m => popular.add(m.id));
  const entry = m => ({ id: 'or:' + m.id, label: m.name.replace(/^[^:]+:/, '').trim(), tool: 'openrouter', model: m.id, desc: price(m), ctx: m.context_length || 32768, popular: popular.has(m.id), cost: cost(m), maker: m.id.split('/')[0] });
  const rank = m => { const i = MAKERS.indexOf(m.maker); return i < 0 ? MAKERS.length : i; };
  const list = all.map(entry).sort((a, b) => (b.popular - a.popular) || (rank(a) - rank(b)) || (a.cost - b.cost) || a.label.localeCompare(b.label));
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
  if (status === 401) return 'OpenRouter did not accept your API key. Check it in Settings, AI.';
  if (status === 402) return 'Your OpenRouter credits ran out (or this model needs credits). Add credits at ' + CREDITS_URL;
  if (status === 429) return 'This model is busy or you reached a limit for now. Wait a moment, or pick another model. ' + (msg ? '(' + String(msg).slice(0, 160) + ')' : '');
  return 'OpenRouter error ' + status + (msg ? ': ' + String(msg).slice(0, 200) : '');
}

// Streams one answer. Returns { content, calls:[{id, function:{name, arguments:string}}] }.
async function chat({ key, model, messages, tools, signal, onEvent }) {
  if (!key) throw new Error('Add your OpenRouter API key first (Settings, AI).');
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

module.exports = { checkKey, catalog, chat, parseArgs, explain, CREDITS_URL, KEYS_URL };
