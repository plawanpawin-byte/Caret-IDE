'use strict';
// The tools the local AI (Aeble) can use. Everything stays inside the open folder.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn, execFile } = require('child_process');

const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

const ALL = {
  list_dir: fn('list_dir', 'List files and folders. Path is relative to the project folder.', { path: { type: 'string', description: 'Folder, e.g. "." or "src"' } }),
  read_file: fn('read_file', 'Read a text file. Returns numbered lines.', { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, ['path']),
  search: fn('search', 'Find text in all project files (case-insensitive). Returns file:line matches.', { query: { type: 'string' } }, ['query']),
  write_file: fn('write_file', 'Create a file or replace its whole content.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  edit_file: fn('edit_file', 'Replace an exact piece of text in a file. old_text must appear exactly once unless replace_all is true. To ADD code, copy the nearby existing text into new_text as well and put the new code next to it, so nothing is lost.', { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean' } }, ['path', 'old_text', 'new_text']),
  run_command: fn('run_command', 'Run a shell command in the project folder (for example the tests or the program) and return its output.', { command: { type: 'string' } }, ['command']),
  update_tasks: fn('update_tasks', 'Show the user your task list. Call it first to split the request into short steps, and again whenever a step starts or finishes.', { tasks: { type: 'array', items: { type: 'object', properties: { content: { type: 'string', description: 'The step, a few words' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['content', 'status'] } } }, ['tasks']),
};
const BY_MODE = {
  plan: ['list_dir', 'read_file', 'search'],
  code: ['update_tasks', 'list_dir', 'read_file', 'search', 'write_file', 'edit_file', 'run_command'],
};
BY_MODE.agent = BY_MODE.code;   // no sub-agents for a local model: Agent mode works like Code

const definitions = (mode, withTasks = true) => (BY_MODE[mode] || BY_MODE.code).filter(n => withTasks || n !== 'update_tasks').map(n => ALL[n]);
const allowedIn = (mode, name) => (BY_MODE[mode] || BY_MODE.code).includes(name);

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', '.idea', '.vscode']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|exe|dll|so|woff2?|ttf|mp[34]|mov|lock)$/i;

function safe(root, p) {
  const abs = path.resolve(root, String(p || '.'));
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('That path is outside the project folder.');
  return abs;
}

function numbered(text, start, end) {
  const lines = text.split(/\r?\n/);
  const s = Math.max(1, start || 1), e = Math.min(lines.length, end || lines.length);
  let out = '';
  for (let i = s; i <= e; i++) out += `${String(i).padStart(5)}  ${lines[i - 1]}\n`;
  if (out.length > 30000) out = out.slice(0, 30000) + `\n…(cut; read a smaller range with start_line/end_line, the file has ${lines.length} lines)`;
  return out || '(empty file)';
}

// After a write, tell the model at once if the file cannot even be parsed.
function syntaxNote(file, code) {
  try {
    if (/\.json$/i.test(file)) JSON.parse(code);
    else if (/\.(js|cjs)$/i.test(file) && !/^\s*(import|export)\s/m.test(code)) new vm.Script(code, { filename: file });
    return '';
  } catch (e) { return ` WARNING: ${file} has a syntax error (${e.message}). Read the file and fix it now.`; }
}

function walk(root, dir, out, limit) {
  let items; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    if (out.length >= limit) return;
    if (it.isDirectory()) { if (!SKIP.has(it.name)) walk(root, path.join(dir, it.name), out, limit); }
    else if (!BINARY.test(it.name)) out.push(path.join(dir, it.name));
  }
}

function runShell(command, cwd, signal) {
  return new Promise(resolve => {
    const win = process.platform === 'win32';
    const p = spawn(win ? 'cmd.exe' : 'sh', win ? ['/d', '/s', '/c', command] : ['-c', command], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', done = false;
    const add = d => { out += d; if (out.length > 20000) out = out.slice(0, 8000) + '\n…\n' + out.slice(-8000); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const kill = () => { if (win) execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {}); else try { p.kill('SIGKILL'); } catch {} };
    const timer = setTimeout(() => { if (!done) { out += '\n[stopped after 60 seconds]'; kill(); } }, 60000);
    if (signal) signal.addEventListener('abort', kill, { once: true });
    const finish = code => { if (done) return; done = true; clearTimeout(timer); resolve(out.trim() + `\n[exit code ${code}]`); };
    p.on('error', e => { out += String(e.message); finish(1); });
    p.on('close', code => finish(code));
  });
}

// run: { root, full, signal, files:[], on }
async function execute(name, args, run) {
  args = args || {};
  const root = run.root;
  switch (name) {
    case 'list_dir': {
      const dir = safe(root, args.path || '.');
      const items = fs.readdirSync(dir, { withFileTypes: true }).filter(d => !SKIP.has(d.name)).slice(0, 300);
      return items.map(d => (d.isDirectory() ? '[dir] ' : '      ') + path.relative(root, path.join(dir, d.name)).replace(/\\/g, '/')).join('\n') || '(empty folder)';
    }
    case 'read_file': {
      const abs = safe(root, args.path);
      const st = fs.statSync(abs);
      if (st.size > 1e6) throw new Error('That file is larger than 1 MB. Use search to find the part you need.');
      return numbered(fs.readFileSync(abs, 'utf8'), args.start_line, args.end_line);
    }
    case 'search': {
      const q = String(args.query || '').toLowerCase();
      if (!q) throw new Error('Give something to search for.');
      const files = []; walk(root, root, files, 4000);
      const hits = [];
      for (const f of files) {
        let text; try { if (fs.statSync(f).size > 1e6) continue; text = fs.readFileSync(f, 'utf8'); } catch { continue; }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && hits.length < 100; i++) if (lines[i].toLowerCase().includes(q)) hits.push(`${path.relative(root, f).replace(/\\/g, '/')}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
        if (hits.length >= 100) break;
      }
      return hits.length ? hits.join('\n') : 'No matches.';
    }
    case 'write_file': {
      const abs = safe(root, args.path);
      const content = String(args.content ?? '');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      run.files.push(rel); run.on.file(rel);
      return `Wrote ${rel} (${content.split('\n').length} lines).` + syntaxNote(rel, content);
    }
    case 'edit_file': {
      const abs = safe(root, args.path);
      let text; try { text = fs.readFileSync(abs, 'utf8'); } catch { throw new Error('That file does not exist. Use write_file to create it.'); }
      const oldT = String(args.old_text ?? ''), newT = String(args.new_text ?? '');
      if (!oldT) throw new Error('old_text is empty.');
      const n = text.split(oldT).length - 1;
      if (n === 0) throw new Error('old_text was not found. Read the file again and copy the text exactly, including spaces and line breaks.');
      if (n > 1 && !args.replace_all) throw new Error(`old_text appears ${n} times. Include more of the surrounding lines so it is unique, or set replace_all.`);
      const next = args.replace_all ? text.split(oldT).join(newT) : text.replace(oldT, () => newT);
      fs.writeFileSync(abs, next);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      run.files.push(rel); run.on.file(rel);
      // A small model sometimes overwrites a function while meaning to add one next to it. Say so at once.
      const gone = [...oldT.matchAll(/(?:function|class|def)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]).filter(n => !new RegExp('(?:function|class|def)\s+' + n + '\b').test(next));
      return `Edited ${rel}.` + (gone.length ? ` WARNING: this edit removed ${gone.join(', ')} from the file. If you did not mean to remove it, put it back now.` : '') + syntaxNote(rel, next);
    }
    case 'run_command': {
      if (!run.full) return 'Not allowed: running commands needs Full access. Tell the user to turn on Full access (the shield button) if they want you to run or test the code.';
      return runShell(String(args.command || ''), root, run.signal);
    }
    case 'update_tasks': return 'ok';
    default: throw new Error('Unknown tool ' + name);
  }
}

module.exports = { definitions, allowedIn, execute };
