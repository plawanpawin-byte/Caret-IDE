'use strict';
// The Connectors page: a webview that lists what the AI can plug into (GitHub, Cloudflare, Supabase, ...) and installs
// or removes each one through Claude Code's own `claude mcp` commands (see catalog.js). Keys are the person's own.
const vscode = require('vscode');
const crypto = require('crypto');
const catalog = require('./catalog');

let panel = null;

function activate(ctx, auth) {
  const open = () => {
    if (panel) { panel.reveal(); return; }
    const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
    panel = vscode.window.createWebviewPanel('caret.connectors', 'Connectors', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [media], retainContextWhenHidden: true });
    const w = panel.webview, u = f => w.asWebviewUri(vscode.Uri.joinPath(media, f));
    const nonce = crypto.randomBytes(16).toString('base64');
    w.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data:; style-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${u('connectors.css')}"></head><body data-roblox="${u('roblox.png')}"><div id="app"></div>
<script nonce="${nonce}" src="${u('connectors.js')}"></script></body></html>`;
    const post = m => { try { panel?.webview.postMessage(m); } catch {} };
    const status = async () => post({ type: 'status', data: await catalog.status() });
    w.onDidReceiveMessage(async m => {
      if (m.type === 'ready' || m.type === 'refresh') return status();
      try {
        const id = String(m.id || '');
        if (m.type === 'install') {
          const login = ctx.globalState.get('caret.login');
          await catalog.install(id, {
            token: String(m.token || ''),
            grant: login ? () => auth.signIn(url => vscode.env.openExternal(vscode.Uri.parse(url)), { grant: true }).then(r => {
              if (String(r.login || '').toLowerCase() !== String(login).toLowerCase()) throw new Error('That was a different GitHub account than the one you are signed in with.');
              return r;
            }) : null,
          }, line => post({ type: 'progress', id, line }));
          post({ type: 'done', id });
        } else if (m.type === 'uninstall') {
          await catalog.uninstall(id, line => post({ type: 'progress', id, line }));
          post({ type: 'done', id });
        }
      } catch (e) { post({ type: 'failed', id: String(m.id || ''), error: String(e.message || e) }); }
      status();
    });
    panel.onDidDispose(() => { panel = null; });
  };
  ctx.subscriptions.push(vscode.commands.registerCommand('caret.connectors', open));
}

module.exports = { activate };
