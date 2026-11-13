'use strict';
// Runs the Claude Code or Codex command-line tool in the open folder and turns what it prints into events:
//   on.text(s)  on.tool({id,name,args,status,result})  on.file(path)
// The tools run on this computer with the person's own sign-in. Nothing here talks to a Caret server.
const { spawn, execFile } = require('child_process');
const os = require('os');
const cli = require('./cli');

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { proc.kill('SIGTERM'); } catch {} }
}

function startCli(name, args, { cwd, stdin }) {
  const c = cli.resolveCli(name);
  if (!c) throw new Error(`${name} is not installed or not on PATH`);
  const proc = spawn(c.cmd, [...c.args, ...args], { cwd, windowsHide: true, env: { ...process.env, ...(c.env || {}) } });
  if (stdin != null) { proc.stdin.on('error', () => {}); proc.stdin.end(stdin); }
  return proc;
}

function lines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); }
  });
  stream.on('end', () => { if (buf.trim()) onLine(buf.trim()); });
}

const short = (v, n = 3000) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };

// mode: 'plan' (read only) | 'edit' (may change files, commands need no approval inside the folder rules of the tool) | 'auto' (everything)
function runClaude({ model, mode, prompt, system, sessionId, cwd, on }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (model && model !== 'default') args.push('--model', model);
  if (sessionId) args.push('--resume', sessionId);
  if (system) args.push('--append-system-prompt', system);
  if (mode === 'plan') args.push('--permission-mode', 'plan');
  else if (mode === 'auto') args.push('--permission-mode', 'bypassPermissions');
  else args.push('--permission-mode', 'acceptEdits');
  const proc = startCli('claude', args, { cwd: cwd || os.homedir(), stdin: prompt });
  const result = { sessionId: null, error: null };
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-10000); });
  let doneNow = () => {};
  lines(proc.stdout, line => {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    if (ev.session_id) result.sessionId = ev.session_id;
    if (ev.type === 'assistant') {
      for (const b of ev.message?.content || []) {
        if (b.type === 'text' && b.text) on.text(b.text);
        else if (b.type === 'tool_use') {
          on.tool({ id: b.id, name: b.name, args: b.input, status: 'running' });
          const fp = b.input?.file_path || b.input?.notebook_path;
          if (fp && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name)) on.file(fp);
        }
      }
    } else if (ev.type === 'user') {
      for (const b of ev.message?.content || []) {
        if (b.type === 'tool_result') {
          const content = Array.isArray(b.content) ? b.content.map(c => c.text || '').join('\n') : b.content;
          on.tool({ id: b.tool_use_id, status: b.is_error ? 'error' : 'done', result: short(content) });
        }
      }
    } else if (ev.type === 'result') {
      if (ev.is_error) result.error = ev.result || ev.subtype || 'Claude stopped with an error';
      // A server the AI left running can hold the pipe open forever: end the run shortly after the answer.
      setTimeout(() => { killTree(proc); doneNow(); }, 1500);
    }
  });
  const done = new Promise(resolve => {
    doneNow = () => resolve(result);
    proc.on('error', e => { result.error = e.message; resolve(result); });
    proc.on('close', code => {
      if (code && !result.error) result.error = stderr.trim().split('\n').slice(-3).join('\n') || `Claude exited with code ${code}`;
      resolve(result);
    });
  });
  return { stop: () => killTree(proc), done };
}

function runCodex({ model, mode, prompt, system, cwd, on }) {
  const root = cwd || os.homedir();
  const args = ['exec', '--json', '--skip-git-repo-check', '-C', root];
  if (model && model !== 'default') args.push('-m', model);
  if (mode === 'plan') args.push('--sandbox', 'read-only');
  else if (mode === 'edit') args.push('--sandbox', 'workspace-write');
  else args.push('--dangerously-bypass-approvals-and-sandbox');
  args.push('-');
  const proc = startCli('codex', args, { cwd: root, stdin: `${system || ''}\n\n---\n\nUSER REQUEST:\n${prompt}` });
  const result = { error: null };
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-10000); });
  let doneNow = () => {};
  lines(proc.stdout, line => {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    const item = ev.item || {};
    if (ev.type === 'item.started' && item.type === 'command_execution') on.tool({ id: item.id, name: 'Bash', args: { command: item.command }, status: 'running' });
    else if (ev.type === 'item.completed') {
      if (item.type === 'agent_message' && item.text) on.text(item.text + '\n');
      else if (item.type === 'command_execution') on.tool({ id: item.id, name: 'Bash', args: { command: item.command }, status: item.exit_code ? 'error' : 'done', result: short(item.aggregated_output || '') });
      else if (item.type === 'file_change') {
        for (const c of item.changes || []) on.file(c.path);
        on.tool({ id: item.id, name: 'Edit', args: { file_path: (item.changes || []).map(c => c.path).join(', ') }, status: 'done' });
      } else if (item.type === 'error' && item.message) result.error = item.message;
    } else if (ev.type === 'turn.completed') setTimeout(() => { killTree(proc); doneNow(); }, 1500);
    else if (ev.type === 'error' || ev.type === 'turn.failed') result.error = ev.message || ev.error?.message || 'Codex failed';
  });
  const done = new Promise(resolve => {
    doneNow = () => resolve(result);
    proc.on('error', e => { result.error = e.message; resolve(result); });
    proc.on('close', code => {
      if (code && !result.error) result.error = stderr.trim().split('\n').slice(-3).join('\n') || `Codex exited with code ${code}`;
      resolve(result);
    });
  });
  return { stop: () => killTree(proc), done };
}

module.exports = { runClaude, runCodex };
