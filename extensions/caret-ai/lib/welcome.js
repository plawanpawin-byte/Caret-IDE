'use strict';
const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const aiconfig = require('./aiconfig');

let panel = null;

async function recent() {
  try {
    const r = await vscode.commands.executeCommand('_workbench.getRecentlyOpened');
    return (r?.workspaces || []).filter(w => w.folderUri).slice(0, 8).map(w => {
      const u = vscode.Uri.from(w.folderUri);
      const p = u.fsPath || u.path;
      return { uri: u.toString(), name: path.basename(p) || p, dir: path.dirname(p) };
    });
  } catch { return []; }
}

async function send(chat) {
  if (!panel) return;
  panel.webview.postMessage({ type: 'state', account: chat.account, items: await recent(), onboarded: !!chat.ctx.globalState.get('caret.onboarded') });
}

async function show(ctx, chat) {
  if (panel) { panel.reveal(); return; }
  const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
  panel = vscode.window.createWebviewPanel('caret.welcome', 'Welcome', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [media] });
  panel.onDidDispose(() => { panel = null; });
  const w = panel.webview, u = f => w.asWebviewUri(vscode.Uri.joinPath(media, f));
  const nonce = crypto.randomBytes(16).toString('base64');
  w.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data:; style-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${u('ui.css')}"><link rel="stylesheet" href="${u('welcome.css')}"></head><body data-logo="${u('logo.png')}"><div id="app"></div>
<script nonce="${nonce}" src="${u('ui.js')}"></script><script nonce="${nonce}" src="${u('welcome.js')}"></script></body></html>`;
  w.onDidReceiveMessage(async m => {
    switch (m?.type) {
      case 'ready': send(chat); break;
      case 'openFolder': vscode.commands.executeCommand('workbench.action.files.openFolder'); break;
      case 'clone': vscode.commands.executeCommand('git.clone'); break;
      case 'newFile': vscode.commands.executeCommand('workbench.action.files.newUntitledFile'); break;
      case 'login': chat.login(); break;
      case 'finishSetup': await aiconfig.handle(chat, m, x => panel && panel.webview.postMessage(x)); send(chat); break;
      case 'open': if (typeof m.uri === 'string') vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.parse(m.uri)); break;
      default: await aiconfig.handle(chat, m, x => panel && panel.webview.postMessage(x));
    }
  });
}

// the stock VS Code welcome page can open on a first run; ours replaces it
function closeStock() {
  const stock = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.label === 'Welcome' && !(t.input instanceof vscode.TabInputWebview && /caret\.welcome/.test(t.input.viewType)));
  if (stock.length) vscode.window.tabGroups.close(stock).then(undefined, () => {});
}

module.exports = { show, closeStock, refresh: send };
