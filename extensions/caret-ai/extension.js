'use strict';
const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const cli = require('./lib/cli');
const welcome = require('./lib/welcome');
const openrouter = require('./lib/openrouter');
const settings = require('./lib/settings');
const { runAgent } = require('./lib/agent');

// The model list comes from OpenRouter (filled in by loadModels). tool: how it runs; model: the name handed to it.
const MODELS = [];
const MODES = ['plan', 'code', 'agent'];
const MODE_NOTE = {
  plan: 'PLAN MODE. Do not change any file and do not run anything that changes the project. Do not write a plan file. If the request is a job to do, reply with the tasks that would get it done, one line per task, each line starting with `[ ] ` (3 to 7 short tasks, nothing else about the list), and do not start the work. If it is only a question or a chat, just answer it normally and write no `[ ]` lines.',
  code: 'TASK LIST (required). For any job that builds or changes files, your FIRST message, before any tool call, is the task list: 3 to 7 short tasks, one line each, each line starting with `[ ] `. Then do the tasks one at a time, in order. Right after you finish a task, write one line `[x] ` followed by the same task text. Write nothing else about the list. Only a plain question or a one-line fix may skip the list.',
  agent: 'TASK LIST (required). For any job that builds or changes files, your FIRST message, before any tool call, is the task list: 3 to 7 short independent tasks, one line each, each line starting with `[ ] `. AGENT MODE: do NOT work through the tasks one by one. Start one sub-agent (the Task tool) per task, all in the same message so they run in parallel, and tell each exactly what to do. When a sub-agent returns, write one line `[x] ` followed by the same task text. Write nothing else about the list. Only a plain question or a one-line fix may skip the list.',
};
const IMG_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;

// The name shown in greetings: this computer's user name.
function localName() { try { return os.userInfo().username || 'there'; } catch { return 'there'; } }

class Chat {
  constructor(ctx) {
    this.ctx = ctx; this.view = null; this.run = null; this.account = { login: localName() };
    this.chats = ctx.globalState.get('caret.allchats') || [];
    this.pending = ctx.globalState.get('caret.pendingChat') || null;
    this.cur = this.blank();
    this.root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
  }

  async init() {
    cli.fixPath();
    // older versions signed in with GitHub; that sign-in is gone, so forget what it left behind
    this.ctx.secrets.delete('caret.token').then(undefined, () => {});
    for (const k of ['caret.login', 'caret.avatar', 'caret.dataOwner']) this.ctx.globalState.update(k, undefined);
    this.orKey = await this.ctx.secrets.get('caret.orkey');
    await this.migrate();
    if (this.moveHist()) await this.ctx.globalState.update('caret.allchats', this.chats);
    this.push(); this.applyPending();
    this.loadModels();
  }
  // The model list comes from OpenRouter. The user decides which models show in the chat menu (Settings, AI).
  async loadModels() {
    try { this.catalog = await openrouter.catalog(); }
    catch (e) { this.catalog = this.catalog || []; if (this.view) this.post({ type: 'error', text: 'Could not load the model list. Check your internet connection.' }); }
    this.syncModels(); this.push();
  }
  enabledIds() {
    const s = this.ctx.globalState.get('caret.enabled');
    return Array.isArray(s) ? s : (this.catalog || []).filter(m => m.popular).map(m => m.id);
  }
  syncModels() {
    const on = new Set(this.enabledIds());
    MODELS.length = 0; MODELS.push(...(this.catalog || []).filter(m => on.has(m.id)));
  }
  async setEnabled(ids) { await this.ctx.globalState.update('caret.enabled', ids.filter(x => typeof x === 'string').slice(0, 400)); this.syncModels(); this.push(); }
  async setKey(key) {
    const r = await openrouter.checkKey(key);
    if (r.ok) { this.orKey = String(key).trim(); await this.ctx.secrets.store('caret.orkey', this.orKey); this.push(); }
    return r;
  }
  async removeKey() { this.orKey = null; await this.ctx.secrets.delete('caret.orkey'); this.push(); }
  maskedKey() { return this.orKey ? 'sk-or-…' + this.orKey.slice(-4) : ''; }
  async migrate() {
    const old = this.ctx.workspaceState.get('caret.chats');
    if (!old || !old.length || !this.root) return;
    for (const c of old) if (!this.chats.some(x => x.id === c.id)) this.chats.push({ ...c, root: this.root });
    await this.ctx.workspaceState.update('caret.chats', undefined);
    await this.ctx.globalState.update('caret.allchats', this.chats);
  }
  applyPending() {
    if (!this.pending || !this.view) return;
    const c = this.mine().find(x => x.id === this.pending);
    this.pending = null; this.ctx.globalState.update('caret.pendingChat', undefined);
    if (c) { this.cur = c; this.post({ type: 'load', msgs: c.msgs }); this.titleNow(); }
  }
  changed() { try { this.onAccount?.(); } catch {} }
  // Everything stays on this computer: chats, settings and the key. There are no accounts.
  me() { return this.account.login; }
  mine() { return this.chats; }
  state() {
    return {
      type: 'state', account: this.account, models: MODELS, or: { connected: !!this.orKey }, root: this.root ? path.basename(this.root) : null,
      busy: !!this.run, last: MODELS.some(m => m.id === this.ctx.globalState.get('caret.model')) ? this.ctx.globalState.get('caret.model') : (MODELS[0] ? MODELS[0].id : ''), mode: MODES.includes(this.ctx.globalState.get('caret.mode')) ? this.ctx.globalState.get('caret.mode') : 'code', perm: this.perm(),
    };
  }
  blank() { return { id: Date.now().toString(36), title: '', session: null, at: Date.now(), msgs: [], hist: [] }; }

  // What the AI may do: readonly (read and search only), auto (edits, safe commands; asks before risky ones), full (everything).
  perm() {
    const p = this.ctx.globalState.get('caret.perm');
    if (['readonly', 'auto', 'full'].includes(p)) return p;
    return this.ctx.globalState.get('caret.full') ? 'full' : 'auto';   // older versions had only a Full access switch
  }
  // Folder trust: asked once when a folder is opened, then remembered. Full access only works in a trusted folder.
  trusted() {
    if (!this.root) return false;
    const list = this.ctx.globalState.get('caret.trusted') || [];
    return vscode.workspace.isTrusted || list.includes(this.root.toLowerCase());
  }
  async askTrust() {
    if (!this.root || this.trusted()) return this.trusted();
    const pick = await vscode.window.showWarningMessage('Do you trust the files in this folder?', { modal: true, detail: this.root + '\n\nCaret AI edits files and runs commands here. Trust it only if you know where the files come from.' }, 'Trust folder');
    if (pick !== 'Trust folder') return false;
    const list = this.ctx.globalState.get('caret.trusted') || [];
    await this.ctx.globalState.update('caret.trusted', [...list, this.root.toLowerCase()].slice(-200));
    return true;
  }
  async setPerm(p) {
    if (!['readonly', 'auto', 'full'].includes(p)) return;
    if (p === 'full' && !this.trusted()) {
      this.push();   // the menu keeps showing what is really set
      if (!this.root) { this.post({ type: 'error', text: 'Open a folder first (File, Open Folder).' }); return; }
      if (!(await this.askTrust())) return;
    }
    await this.ctx.globalState.update('caret.perm', p);
    this.push();
  }
  async ask(title, detail) {
    const pick = await vscode.window.showWarningMessage(title, { modal: true, detail: String(detail || '').slice(0, 1500) }, 'Allow');
    return pick === 'Allow';
  }

  // The whole session the model sees (messages and tool results) lives in one file per chat, not in the settings database.
  histFile(id) { return path.join(this.ctx.globalStorageUri.fsPath, 'hist', String(id).replace(/[^a-z0-9]/gi, '') + '.json'); }
  loadHist(c) {
    if (Array.isArray(c.hist)) return c.hist;
    try { c.hist = JSON.parse(fs.readFileSync(this.histFile(c.id), 'utf8')); } catch { c.hist = []; }
    return c.hist;
  }
  saveHist(c) {
    try { const f = this.histFile(c.id); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(c.hist || [])); } catch {}
  }
  moveHist() {   // older versions kept a short copy of each chat inside the settings database
    let moved = false;
    for (const c of this.chats) if (Array.isArray(c.hist)) { if (c.hist.length && !fs.existsSync(this.histFile(c.id))) this.saveHist(c); c.hist = undefined; moved = true; }
    return moved;
  }
  dropOldHist() {
    try {
      const dir = path.dirname(this.histFile('x'));
      const keep = new Set(this.chats.map(c => this.histFile(c.id)));
      for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (!keep.has(p)) fs.rmSync(p, { force: true }); }
    } catch {}
  }
  get session() { return this.cur.session; }
  titleNow() { try { if (this.view) this.view.title = this.cur.title || 'New chat'; } catch {} }
  // Keep finished chats in the workspace so the history list can bring them back.
  async save() {
    if (!this.cur.msgs.length || !this.me()) return;
    this.cur.owner = this.me();
    this.cur.at = Date.now();
    this.cur.root = this.root; this.cur.folder = this.root ? path.basename(this.root) : '';
    this.chats = [this.cur, ...this.chats.filter(c => c.id !== this.cur.id)].slice(0, 200);
    await this.ctx.globalState.update('caret.allchats', this.chats.map(c => ({ ...c, hist: undefined })));
    if (Array.isArray(this.cur.hist)) this.saveHist(this.cur);
    this.dropOldHist();
  }
  async newChat() {
    await this.save();
    this.cur = this.blank();
    this.post({ type: 'cleared' }); this.titleNow();
  }
  // History is grouped by folder (small grey folder names). Picking a chat from another folder opens that folder and the chat.
  async history() {
    await this.save();
    if (!this.mine().length) { vscode.window.showInformationMessage('No chats yet.'); return; }
    const ago = t => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
    const groups = new Map();
    for (const c of this.mine()) { const k = c.root || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
    const keys = [...groups.keys()].sort((a, b) => (b === this.root) - (a === this.root) || groups.get(b)[0].at - groups.get(a)[0].at);
    const items = [];
    for (const k of keys) {
      items.push({ label: k ? path.basename(k) : 'No folder', kind: vscode.QuickPickItemKind.Separator });
      for (const c of groups.get(k)) items.push({ label: c.title || 'Chat', description: ago(c.at), id: c.id });
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Chat history' });
    if (!pick || !pick.id || this.run) return;
    const c = this.mine().find(x => x.id === pick.id);
    if (!c) return;
    if (c.root && c.root !== this.root) {
      if (!fs.existsSync(c.root)) { vscode.window.showWarningMessage('That folder no longer exists: ' + c.root); return; }
      await this.ctx.globalState.update('caret.pendingChat', c.id);
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(c.root), { forceNewWindow: false });
      return;
    }
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
      case 'ready': this.push(); this.applyPending(); break;
      case 'send': await this.send(m); break;
      case 'stop': this.run?.stop(); break;
      case 'newChat': await this.newChat(); break;
      case 'openSettings': vscode.commands.executeCommand('caret.openSettings', m.section); break;
      case 'saveKey': case 'link': await require('./lib/aiconfig').handle(this, m, p => this.post(p)); break;
      case 'setModel': if (MODELS.some(x => x.id === m.id)) await this.ctx.globalState.update('caret.model', m.id); break;
      case 'setPerm': await this.setPerm(m.perm); break;
      case 'setMode': if (MODES.includes(m.mode)) await this.ctx.globalState.update('caret.mode', m.mode); break;
      case 'openFile': this.openFile(String(m.path || '')); break;
    }
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
    const text = String(m.text || '').trim().slice(0, 20000);
    if (!text) return;
    const pick = MODELS.find(x => x.id === m.model) || MODELS[0];
    if (!pick) { this.post({ type: 'error', text: 'The model list is not loaded yet. Check your internet connection and try again.' }); return; }
    if (pick.tool === 'openrouter' && !this.orKey) { this.post({ type: 'error', text: 'Connect your AI account first (the button above the message box).' }); return; }
    const mode = MODES.includes(m.mode) ? m.mode : 'code';
    let perm = this.perm();
    if (perm === 'full' && !this.trusted()) {   // a different folder may be open now
      perm = 'auto'; await this.ctx.globalState.update('caret.perm', 'auto'); this.push();
      this.post({ type: 'error', text: 'This folder is not trusted, so Full access was switched back to Auto.' });
    }
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
    const prompt = this.context() + attach + text;   // the open file and the selection go along with every message
    const msgs = this.cur.msgs;
    if (!msgs.length) { this.cur.title = text.replace(/\s+/g, ' ').slice(0, 40); this.titleNow(); }
    msgs.push({ r: 'user', t: text.slice(0, 8000), n: files.length });
    const on = {
      text: t => { msgs.push({ r: 'ai', t: String(t).slice(0, 8000) }); this.post({ type: 'text', text: t }); },
      tool: t => {
        const prev = msgs.find(m => m.r === 'tool' && m.id === t.id) || {}; const tname = t.name || prev.name;
        const rec = { r: 'tool', id: t.id, name: tname, args: t.args && typeof t.args === 'object' ? { command: t.args.command, file_path: t.args.file_path, path: t.args.path, pattern: t.args.pattern, todos: Array.isArray(t.args.todos) ? t.args.todos.slice(0, 40).map(x => ({ content: String(x.content || x.subject || '').slice(0, 200), status: x.status })) : undefined } : t.args, status: t.status, result: t.result && !/^(read_file|search|run_command|list_dir)$/.test(tname || '') ? String(t.result).slice(0, 600) : undefined };   // what the AI read or ran is not kept on disk (it can hold secrets)

        const i = msgs.findIndex(m => m.r === 'tool' && m.id === t.id);
        if (i >= 0) msgs[i] = rec; else msgs.push(rec);
        if (msgs.length > 300) msgs.splice(0, msgs.length - 300);
        this.post({ type: 'tool', tool: t });
      },
      thinking: t => this.post({ type: 'thinking', text: String(t).slice(0, 4000) }),
      status: t => this.post({ type: 'status', text: String(t).slice(0, 200) }),
      file: f => this.post({ type: 'file', path: path.isAbsolute(f) && this.root ? path.relative(this.root, f) : f }),
    };
    this.post({ type: 'start', mode });
    try {
      this.run = runAgent({ key: this.orKey, model: pick.model, mode, perm, prompt, system: mode === 'plan' ? MODE_NOTE.plan : '', history: this.loadHist(this.cur), cwd: this.root, numCtx: pick.ctx, confirm: (title, detail) => this.ask(title, detail), on });
      this.push();
      const r = await this.run.done;
      if (Array.isArray(r.messages)) this.cur.hist = r.messages;   // the whole session, summarized by the agent when it gets long
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
    vscode.commands.registerCommand('caret.openSettings', section => settings.show(ctx, chat, typeof section === 'string' ? section : 'profile')),
  );
  chat.init().then(() => {
    if (!ctx.globalState.get('caret.onboarded') || !vscode.workspace.workspaceFolders?.length) welcome.show(ctx, chat);
    setTimeout(welcome.closeStock, 2500);
    setTimeout(() => vscode.commands.executeCommand('caret.chat.focus'), 1200);
    // a folder was opened that has not been trusted yet: ask once, the answer is remembered
    if (chat.root && !process.env.CARET_DEV_OPEN_CHAT) setTimeout(() => chat.askTrust().then(() => chat.push()), 3000);
  });
  // test hook for screenshots: CARET_DEV_OPEN_CHAT=1
  if (process.env.CARET_DEV_OPEN_CHAT) setTimeout(() => vscode.commands.executeCommand('caret.chat.focus'), 1500);
}
function deactivate() {}
module.exports = { activate, deactivate };
