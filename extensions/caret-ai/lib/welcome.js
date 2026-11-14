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
      case 'ssh': connectSsh(); break;
      case 'login': chat.login(); break;
      case 'finishSetup': await aiconfig.handle(chat, m, x => panel && panel.webview.postMessage(x)); send(chat); break;
      case 'open': if (typeof m.uri === 'string') vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.parse(m.uri)); break;
      default: await aiconfig.handle(chat, m, x => panel && panel.webview.postMessage(x));
    }
  });
}

// Connect via SSH needs the free Open Remote - SSH extension (Open VSX). Ask once, install it, then it works from the same button.
async function connectSsh() {
  const have = (await vscode.commands.getCommands(true)).includes('openremotessh.openEmptyWindow');
  if (have) { vscode.commands.executeCommand('openremotessh.openEmptyWindow'); return; }
  const pick = await vscode.window.showInformationMessage('Connecting over SSH needs the free extension "Open Remote - SSH" (from Open VSX). Install it now?', 'Install', 'Cancel');
  if (pick !== 'Install') return;
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Installing Open Remote - SSH' }, () => vscode.commands.executeCommand('workbench.extensions.installExtension', 'jeanp413.open-remote-ssh'));
    const next = await vscode.window.showInformationMessage('Installed. Reload Caret IDE, then press Connect via SSH again.', 'Reload');
    if (next === 'Reload') vscode.commands.executeCommand('workbench.action.reloadWindow');
  } catch (e) { vscode.window.showErrorMessage('Could not install the extension: ' + String(e.message || e)); }
}

// the stock VS Code welcome page can open on a first run; ours replaces it
function closeStock() {
  const stock = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.label === 'Welcome' && !(t.input instanceof vscode.TabInputWebview && /caret\.welcome/.test(t.input.viewType)));
  if (stock.length) vscode.window.tabGroups.close(stock).then(undefined, () => {});
}

module.exports = { show, closeStock, refresh: send };
