'use strict';
const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const auth = require('./lib/auth');
const cli = require('./lib/cli');
const welcome = require('./lib/welcome');
const { runClaude, runCodex } = require('./lib/runners');

const MODELS = [
  { id: 'claude:default', label: 'Claude Code' },
  { id: 'claude:opus', label: 'Claude Opus' },
  { id: 'claude:sonnet', label: 'Claude Sonnet' },
  { id: 'claude:haiku', label: 'Claude Haiku' },
  { id: 'codex:default', label: 'Codex' },
];
const SYSTEM = 'You are the coding assistant inside Caret IDE, working in the open folder. Be direct and concise. Make the change when asked; say what you changed in one or two sentences.';

class Chat {
  constructor(ctx) {
    this.ctx = ctx; this.view = null; this.run = null; this.account = null;
    this.chats = ctx.workspaceState.get('caret.chats') || [];
    this.cur = this.blank();
    this.root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
  }

  async init() {
    cli.fixPath();
    const token = await this.ctx.secrets.get('caret.token');
    const login = this.ctx.globalState.get('caret.login');
    if (token && login) this.account = { login };
    if (token) {
      const me = await auth.check(token);
      if (me === null) await this.clearAccount();
      else if (me) { this.account = { login: me.login }; await this.ctx.globalState.update('caret.login', me.login); }
    }
    this.push();
  }
  changed() { try { this.onAccount?.(); } catch {} }
  async clearAccount() {
    this.account = null;
    await this.ctx.secrets.delete('caret.token');
    await this.ctx.globalState.update('caret.login', undefined);
  }

  state() {
    return {
      type: 'state', account: this.account, models: MODELS, root: this.root ? path.basename(this.root) : null,
      tools: { claude: !!cli.resolveCli('claude'), codex: !!cli.resolveCli('codex') },
      busy: !!this.run, last: this.ctx.globalState.get('caret.model') || 'claude:default', mode: this.ctx.globalState.get('caret.mode') || 'edit',
    };
  }
  blank() { return { id: Date.now().toString(36), title: '', session: null, at: Date.now(), msgs: [] }; }
  get session() { return this.cur.session; }
  titleNow() { try { if (this.view) this.view.title = this.cur.title || 'New chat'; } catch {} }
  // Keep finished chats in the workspace so the history list can bring them back.
  async save() {
    if (!this.cur.msgs.length) return;
    this.cur.at = Date.now();
    this.chats = [this.cur, ...this.chats.filter(c => c.id !== this.cur.id)].slice(0, 40);
    await this.ctx.workspaceState.update('caret.chats', this.chats);
  }
  async newChat() {
    await this.save();
    this.cur = this.blank();
    this.post({ type: 'cleared' }); this.titleNow();
  }
  async history() {
    await this.save();
    if (!this.chats.length) { vscode.window.showInformationMessage('No chats yet.'); return; }
    const ago = t => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
    const pick = await vscode.window.showQuickPick(this.chats.map(c => ({ label: c.title || 'Chat', description: ago(c.at), id: c.id })), { placeHolder: 'Chat history' });
    if (!pick) return;
    const c = this.chats.find(x => x.id === pick.id);
    if (!c || this.run) return;
    this.cur = c; this.post({ type: 'load', msgs: c.msgs }); this.titleNow();
  }
  push() { this.post(this.state()); }
  post(m) { try { this.view?.webview.postMessage(m); } catch {} }

  resolveWebviewView(view) {
    this.view = view; this.titleNow();
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const w = view.webview, u = f => w.asWebviewUri(vscode.Uri.joinPath(media, f));
    const nonce = crypto.randomBytes(16).toString('base64');
    w.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data:; style-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${u('chat.css')}"></head><body data-logo="${u('logo.png')}"><div id="app"></div>
<script nonce="${nonce}" src="${u('chat.js')}"></script></body></html>`;
    w.onDidReceiveMessage(m => this.onMessage(m));
    view.onDidDispose(() => { this.view = null; });
  }

  async onMessage(m) {
    switch (m?.type) {
      case 'ready': this.push(); break;
      case 'send': await this.send(m); break;
      case 'stop': this.run?.stop(); break;
      case 'newChat': await this.newChat(); break;
      case 'login': await this.login(); break;
      case 'logout': { const t = await this.ctx.secrets.get('caret.token'); if (t) await auth.logout(t); await this.clearAccount(); this.push(); this.changed(); break; }
      case 'setModel': if (MODELS.some(x => x.id === m.id)) await this.ctx.globalState.update('caret.model', m.id); break;
      case 'setMode': if (['plan', 'edit', 'auto'].includes(m.mode)) await this.ctx.globalState.update('caret.mode', m.mode); break;
      case 'openFile': this.openFile(String(m.path || '')); break;
    }
  }

  async login() {
    try {
      const a = await auth.signIn(url => vscode.env.openExternal(vscode.Uri.parse(url)));
      await this.ctx.secrets.store('caret.token', a.token);
      await this.ctx.globalState.update('caret.login', a.login);
      this.account = { login: a.login };
      this.push(); this.changed();
    } catch (e) { this.post({ type: 'error', text: String(e.message || e) }); this.push(); }
  }

  openFile(p) {
    if (!p || !this.root) return;
    const abs = path.isAbsolute(p) ? p : path.join(this.root, p);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return; // only files inside the open folder
    vscode.window.showTextDocument(vscode.Uri.file(abs), { preview: true }).then(undefined, () => {});
  }

  context() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.uri.scheme !== 'file') return '';
    const rel = this.root ? path.relative(this.root, ed.document.uri.fsPath) : ed.document.uri.fsPath;
    let s = `Active file: ${rel}\n`;
    if (!ed.selection.isEmpty) {
      const text = ed.document.getText(ed.selection);
      s += `Selected lines ${ed.selection.start.line + 1}-${ed.selection.end.line + 1}:\n\`\`\`\n${text.slice(0, 6000)}\n\`\`\`\n`;
    }
    return s + '\n';
  }

  async send(m) {
    if (this.run) return;
    if (!this.account) { this.post({ type: 'error', text: 'Log in first.' }); return; }
    const text = String(m.text || '').trim().slice(0, 20000);
    if (!text) return;
    const [tool, model] = String(m.model || 'claude:default').split(':');
    const mode = ['plan', 'edit', 'auto'].includes(m.mode) ? m.mode : 'edit';
    if (!this.root) { this.post({ type: 'error', text: 'Open a folder first (File, Open Folder).' }); return; }
    if (mode === 'auto') {
      const ok = await vscode.window.showWarningMessage('Full access lets the AI run any command and change any file without asking. Use it only in a folder you trust.', { modal: true }, 'Allow once');
      if (ok !== 'Allow once') return;
    }
    const prompt = (m.withContext ? this.context() : '') + text;
    const msgs = this.cur.msgs;
    if (!msgs.length) { this.cur.title = text.replace(/\s+/g, ' ').slice(0, 40); this.titleNow(); }
    msgs.push({ r: 'user', t: text.slice(0, 8000) });
    const on = {
      text: t => { msgs.push({ r: 'ai', t: String(t).slice(0, 8000) }); this.post({ type: 'text', text: t }); },
      tool: t => {
        const rec = { r: 'tool', id: t.id, name: t.name, args: t.args && typeof t.args === 'object' ? { command: t.args.command, file_path: t.args.file_path, path: t.args.path, pattern: t.args.pattern } : t.args, status: t.status, result: t.result ? String(t.result).slice(0, 1500) : undefined };
        const i = msgs.findIndex(m => m.r === 'tool' && m.id === t.id);
        if (i >= 0) msgs[i] = rec; else msgs.push(rec);
        if (msgs.length > 300) msgs.splice(0, msgs.length - 300);
        this.post({ type: 'tool', tool: t });
      },
      file: f => this.post({ type: 'file', path: path.isAbsolute(f) && this.root ? path.relative(this.root, f) : f }),
    };
    this.post({ type: 'start' });
    try {
      this.run = tool === 'codex' ? runCodex({ model, mode, prompt, system: SYSTEM, cwd: this.root, on })
        : runClaude({ model, mode, prompt, system: SYSTEM, sessionId: this.session, cwd: this.root, on });
      this.push();
      const r = await this.run.done;
      if (r.sessionId) this.cur.session = r.sessionId;
      await this.save();
      this.post({ type: 'done', error: r.error || null });
    } catch (e) { this.post({ type: 'done', error: String(e.message || e) }); }
    this.run = null; this.push();
  }
}

function activate(ctx) {
  const chat = new Chat(ctx);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('caret.chat', chat, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('caret.openChat', () => vscode.commands.executeCommand('caret.chat.focus')),
    vscode.commands.registerCommand('caret.newChat', () => { chat.newChat(); vscode.commands.executeCommand('caret.chat.focus'); }),
    vscode.commands.registerCommand('caret.history', () => chat.history()),
    vscode.commands.registerCommand('caret.welcome', () => welcome.show(ctx, chat)),
    vscode.commands.registerCommand('caret.signIn', () => chat.login()),
    vscode.commands.registerCommand('caret.signOut', () => chat.onMessage({ type: 'logout' })),
  );
  chat.onAccount = () => {
    welcome.refresh(chat);
    if (chat.account) {
      vscode.commands.executeCommand('workbench.view.explorer');
      vscode.commands.executeCommand('caret.chat.focus');
      if (!vscode.workspace.workspaceFolders?.length) welcome.show(ctx, chat);
    } else {
      welcome.show(ctx, chat);
      vscode.commands.executeCommand('workbench.action.closeSidebar');
      vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    }
  };
  chat.init().then(() => {
    if (!chat.account || !vscode.workspace.workspaceFolders?.length) welcome.show(ctx, chat);
    setTimeout(welcome.closeStock, 2500);
    if (!chat.account) { vscode.commands.executeCommand('workbench.action.closeSidebar'); vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar'); }
    else setTimeout(() => vscode.commands.executeCommand('caret.chat.focus'), 1200);
  });
  // test hook for screenshots: CARET_DEV_OPEN_CHAT=1
  if (process.env.CARET_DEV_OPEN_CHAT) setTimeout(() => vscode.commands.executeCommand('caret.chat.focus'), 1500);
}
function deactivate() {}
module.exports = { activate, deactivate };
