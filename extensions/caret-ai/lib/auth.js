'use strict';
// Signing in to Caret IDE with GitHub through the Carnet website (same flow as Caret Agent):
// open the site with a random state and a PKCE challenge, wait on a port only this computer can reach, trade the
// one-time code (plus the PKCE verifier kept here) for an app token. `grant` asks for GitHub access instead,
// for the GitHub connector; that token is returned to the caller and never stored by this module.
const http = require('http');
const crypto = require('crypto');

const SITE = 'https://carnet.scratch-2026-11-04-b765df.workers.dev';
const WAIT_MS = 5 * 60 * 1000;
const b64u = buf => Buffer.from(buf).toString('base64url');
let pending = null;

const page = (ok, text) => `<!doctype html><meta charset="utf-8"><title>Caret IDE</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#040200;color:#ededed;font:16px system-ui,sans-serif">
<div style="text-align:center;max-width:420px;padding:24px"><h1 style="font-size:22px;margin:0 0 10px">${ok ? 'You are signed in' : 'Sign-in did not finish'}</h1><p style="color:#9a9a9a;margin:0">${text}</p></div>`;

// openExternal(url) opens the browser. Resolves with { login, token, avatar } or { githubToken, login } for grant.
function signIn(openExternal, { grant = false } = {}) {
  if (pending) pending.cancel(new Error('A new sign-in was started.'));
  const verifier = b64u(crypto.randomBytes(32));
  const state = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  return new Promise((resolve, reject) => {
    let done = false, timer = null, port = 0;
    const server = http.createServer(async (req, res) => {
      const reply = (status, body) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(body); };
      try {
        if (req.headers.host !== `127.0.0.1:${port}`) return reply(400, 'Bad request');   // DNS rebinding guard
        const u = new URL(req.url, 'http://127.0.0.1');
        if (req.method !== 'GET' || u.pathname !== '/cb') return reply(404, 'Not found');
        const got = u.searchParams.get('state') || '';
        if (got.length !== state.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(state))) return reply(403, page(false, 'This is not the sign-in Caret IDE started. Close this tab and try again.'));
        const r = await fetch(SITE + '/api/app/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: u.searchParams.get('code') || '', verifier }) });
        const j = await r.json().catch(() => ({}));
        if (grant) {
          if (!r.ok || typeof j.githubToken !== 'string' || !/^[A-Za-z0-9_\-.]{20,255}$/.test(j.githubToken)) { reply(400, page(false, 'GitHub access was not given.')); return finish(new Error('GitHub access was not given.')); }
          reply(200, page(true, 'GitHub is connected. You can close this tab.'));
          return finish(null, { githubToken: j.githubToken, login: j.login });
        }
        if (!r.ok || typeof j.token !== 'string' || typeof j.login !== 'string') { reply(400, page(false, 'The website did not accept the sign-in. Try again from Caret IDE.')); return finish(new Error('The website did not accept the sign-in.')); }
        reply(200, page(true, 'Caret IDE is ready. You can close this tab.'));
        finish(null, { login: j.login, token: j.token, avatar: j.avatar || null });
      } catch { reply(500, page(false, 'Something went wrong. Go back to Caret IDE and try again.')); finish(new Error('Sign-in failed.')); }
    });
    function finish(err, value) {
      if (done) return;
      done = true; clearTimeout(timer); pending = null;
      setTimeout(() => { try { server.close(); } catch {} }, 500);
      err ? reject(err) : resolve(value);
    }
    pending = { cancel: e => finish(e) };
    server.on('error', e => finish(new Error('Could not listen on this computer: ' + e.message)));
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      timer = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), WAIT_MS);
      const url = grant ? `${SITE}/auth/app/github?port=${port}&state=${state}&challenge=${challenge}&grant=github`
        : `${SITE}/auth/app?port=${port}&state=${state}&challenge=${challenge}`;
      Promise.resolve(openExternal(url)).catch(() => finish(new Error('Could not open the browser.')));
    });
  });
}

const cancel = () => { if (pending) pending.cancel(new Error('Cancelled.')); };

// null = signed out for sure (the site refused the token), undefined = could not tell (offline)
async function check(token) {
  if (!token) return null;
  try {
    const r = await fetch(SITE + '/api/app/me', { headers: { authorization: 'Bearer ' + token } });
    if (r.status === 401) return null;
    if (r.ok) return await r.json();
  } catch {}
  return undefined;
}
async function logout(token) {
  try { await fetch(SITE + '/api/app/logout', { method: 'POST', headers: { authorization: 'Bearer ' + token } }); } catch {}
}

module.exports = { signIn, cancel, check, logout, SITE };
