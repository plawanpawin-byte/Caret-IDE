'use strict';
// The Settings page: Profile and AI live here; the other entries open the usual VS Code screens.
const vscode = require('vscode');
const crypto = require('crypto');
const aiconfig = require('./aiconfig');
const update = require('./update');

let panel = null;

// The names match the gear menu. Each opens the stock screen for it.
const COMMANDS = {
  palette: 'workbench.action.showCommands', profiles: 'workbench.profiles.actions.manageProfiles', settings: 'workbench.action.openSettings2',
  extensions: 'workbench.view.extensions', keys: 'workbench.action.openGlobalKeybindings', snippets: 'workbench.action.openSnippets',
  tasks: 'workbench.action.tasks.runTask', themes: 'workbench.action.selectTheme', density: 'workbench.action.setLayoutDensity',
};

async function state(chat) {
  const s = await aiconfig.ai(chat);
  return { ...s, type: 'settings', account: chat.account, version: update.version(), autoUpdate: vscode.workspace.getConfiguration('caret').get('autoUpdate') !== false };
}

async function show(ctx, chat, section) {
  if (panel) { panel.reveal(); panel.webview.postMessage({ type: 'goto', section }); return; }
  const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
  panel = vscode.window.createWebviewPanel('caret.settings', 'Settings', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [media] });
  panel.onDidDispose(() => { panel = null; });
  const w = panel.webview, u = f => w.asWebviewUri(vscode.Uri.joinPath(media, f));
  const nonce = crypto.randomBytes(16).toString('base64');
  w.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data:; style-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${u('ui.css')}"><link rel="stylesheet" href="${u('settings.css')}"></head><body data-section="${section || 'profile'}"><div id="app"></div>
<script nonce="${nonce}" src="${u('ui.js')}"></script><script nonce="${nonce}" src="${u('settings.js')}"></script></body></html>`;
  const post = m => panel && panel.webview.postMessage(m);
  w.onDidReceiveMessage(async m => {
    if (!m) return;
    if (m.type === 'ready') { post(await state(chat)); return; }
    if (m.type === 'checkUpdate') { update.check({ manual: true }); return; }
    if (m.type === 'feedback') { update.feedback(); return; }
    if (m.type === 'setAutoUpdate') { await vscode.workspace.getConfiguration('caret').update('autoUpdate', !!m.on, vscode.ConfigurationTarget.Global); post(await state(chat)); return; }
    if (m.type === 'cmd') { if (COMMANDS[m.name]) vscode.commands.executeCommand(COMMANDS[m.name]).then(undefined, () => {}); return; }
    if (await aiconfig.handle(chat, m, post)) {
      if (m.type === 'saveRole') post(await state(chat));
    }
  });
}

module.exports = { show };
