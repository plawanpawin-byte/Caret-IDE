'use strict';
const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const auth = require('./lib/auth');
const cli = require('./lib/cli');
const welcome = require('./lib/welcome');
const { runClaude, runCodex } = require('./lib/runners');

// tool: which command-line tool runs it; model: the name handed to that tool.
const MODELS = [
  { id: 'sonnet-5-5', label: 'Sonnet 5.5', tool: 'claude', model: 'claude-sonnet-5-5' },
  { id: 'haiku-5-5', label: 'Haiku 5.5', tool: 'claude', model: 'claude-haiku-5-5' },
  { id: 'opus-5-5', label: 'Opus 5.5', tool: 'claude', model: 'claude-opus-5-5' },
  { id: 'fable-5-2', label: 'Fable 5.2', tool: 'claude', model: 'claude-fable-5-2' },
];
const MODES = ['plan', 'code', 'agent'];
const MODE_NOTE = {
  plan: 'PLAN MODE. Do not change any file and do not run anything that changes the project. Do not write a plan file. If the request is a job to do, reply with the tasks that would get it done, one line per task, each line starting with `[ ] ` (nothing else about the list), and do not start the work. If it is only a question or a chat, just answer it normally and write no `[ ]` lines.',
  code: 'TASK LIST. When the job has two or more steps, FIRST write the list in one short message, one line per task, each line starting with `[ ] `. Then, right after you finish a task, write one line `[x] ` followed by the same task text. Write nothing else about the list. For a simple question or a one-step job, skip the list.',
  agent: 'TASK LIST. When the job has two or more steps, FIRST write the list in one short message, one line per task, each line starting with `[ ] `. Then, right after you finish a task, write one line `[x] ` followed by the same task text. Write nothing else about the list. For a simple question or a one-step job, skip the list. AGENT MODE. Split the work into independent sub-tasks, give each to its own sub-agent (the Task tool) and combine their results. Keep the plan short.',
};
const IMG_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
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
      busy: !!this.run, last: MODELS.some(m => m.id === this.ctx.globalState.get('caret.model')) ? this.ctx.globalState.get('caret.model') : MODELS[0].id, mode: MODES.includes(this.ctx.globalState.get('caret.mode')) ? this.ctx.globalState.get('caret.mode') : 'code', full: !!this.ctx.globalState.get('caret.full'),
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
      case 'setFull': await this.ctx.globalState.update('caret.full', !!m.full); break;
      case 'setMode': if (MODES.includes(m.mode)) await this.ctx.globalState.update('caret.mode', m.mode); break;
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
    const pick = MODELS.find(x => x.id === m.model) || MODELS[0];
    const mode = MODES.includes(m.mode) ? m.mode : 'code';
    const full = !!m.full && vscode.workspace.isTrusted;   // no Full access in a folder that is not trusted
    if (m.full && !full) this.post({ type: 'error', text: 'This folder is not trusted, so Full access is off for this message. Trust the folder (the Restricted Mode badge at the bottom) to use it.' });
    if (!this.root) { this.post({ type: 'error', text: 'Open a folder first (File, Open Folder).' }); return; }
    // Pasted pictures go to a temporary folder; the tools read them from there.
    const files = [];
    const imgs = Array.isArray(m.images) ? m.images.slice(0, 6) : [];
    if (imgs.length) {
      const dir = path.join(os.tmpdir(), 'caret-images');
      fs.mkdirSync(dir, { recursive: true });
      imgs.forEach((u, i) => {
        const g = IMG_RE.exec(String(u));
        if (!g || g[2].length > 11e6) return;
        const f = path.join(dir, `${Date.now().toString(36)}-${i}.${g[1] === 'jpeg' ? 'jpg' : g[1]}`);
        fs.writeFileSync(f, Buffer.from(g[2], 'base64')); files.push(f);
      });
    }
    const attach = files.length ? 'Attached image files (open them with the Read tool):\n' + files.map(f => '- ' + f).join('\n') + '\n\n' : '';
    const prompt = (m.withContext ? this.context() : '') + attach + text;
    const system = SYSTEM + (MODE_NOTE[mode] ? '\n\n' + MODE_NOTE[mode] : '');
    const msgs = this.cur.msgs;
    if (!msgs.length) { this.cur.title = text.replace(/\s+/g, ' ').slice(0, 40); this.titleNow(); }
    msgs.push({ r: 'user', t: text.slice(0, 8000), n: files.length });
    const on = {
      text: t => { msgs.push({ r: 'ai', t: String(t).slice(0, 8000) }); this.post({ type: 'text', text: t }); },
      tool: t => {
        const rec = { r: 'tool', id: t.id, name: t.name, args: t.args && typeof t.args === 'object' ? { command: t.args.command, file_path: t.args.file_path, path: t.args.path, pattern: t.args.pattern, todos: Array.isArray(t.args.todos) ? t.args.todos.slice(0, 40).map(x => ({ content: String(x.content || x.subject || '').slice(0, 200), status: x.status })) : undefined } : t.args, status: t.status, result: t.result ? String(t.result).slice(0, 1500) : undefined };
        const i = msgs.findIndex(m => m.r === 'tool' && m.id === t.id);
        if (i >= 0) msgs[i] = rec; else msgs.push(rec);
        if (msgs.length > 300) msgs.splice(0, msgs.length - 300);
        this.post({ type: 'tool', tool: t });
      },
      thinking: t => this.post({ type: 'thinking', text: String(t).slice(0, 4000) }),
      file: f => this.post({ type: 'file', path: path.isAbsolute(f) && this.root ? path.relative(this.root, f) : f }),
    };
    this.post({ type: 'start' });
    try {
      const rmode = mode === 'plan' ? 'plan' : (full ? 'auto' : 'edit');   // Full access: the tool asks for nothing
      this.run = pick.tool === 'codex' ? runCodex({ model: pick.model, mode: rmode, prompt, system, images: files, cwd: this.root, on })
        : runClaude({ model: pick.model, mode: rmode, prompt, system, sessionId: this.session, addDirs: files.length ? [path.dirname(files[0])] : [], cwd: this.root, on });
      this.push();
      const r = await this.run.done;
      if (r.sessionId) this.cur.session = r.sessionId;
      await this.save();
      this.post({ type: 'done', error: r.error || null, plan: mode === 'plan' && !r.error });
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
