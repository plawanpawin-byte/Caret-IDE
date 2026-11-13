'use strict';
const { spawn } = require('child_process');
// Runs a command and passes each output line to onLine. Resolves { ok, error }.
function stream(file, args, onLine, timeoutMs, extraEnv) {
  return new Promise(resolve => {
    let proc;
    try { proc = spawn(file, args, { windowsHide: true, env: { ...process.env, ...(extraEnv || {}) } }); } catch (e) { resolve({ ok: false, error: e.message }); return; }
    const timer = setTimeout(() => { try { proc.kill(); } catch {} }, timeoutMs);
    const feed = d => String(d).split(/\r?\n/).map(l => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()).filter(Boolean).forEach(onLine);
    proc.stdout.on('data', feed); proc.stderr.on('data', feed);
    proc.on('error', e => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
    proc.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, error: code === 0 ? null : `Exited with code ${code}` }); });
  });
}
module.exports = { stream };
