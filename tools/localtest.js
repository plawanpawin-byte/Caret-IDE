'use strict';
// Runs the local AI on 5 small jobs in temp folders and checks the results by running the code.
// Usage: node tools/localtest.js <ollama model> [only-task-number]   (for example: node tools/localtest.js aeble-2.5)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runLocal } = require('../extensions/caret-ai/lib/local');

const model = process.argv[2] || 'aeble-2.5';
const only = process.argv[3] ? Number(process.argv[3]) : 0;
const think = /qwen3|gemma4|nemotron/.test(model) ? false : undefined;   // reasoning models: switch the thinking off to keep it fast

const node = (cwd, file) => { try { return execFileSync(process.execPath, [file], { cwd, encoding: 'utf8', timeout: 20000 }).trim(); } catch (e) { return 'ERR ' + String(e.stdout || e.message).slice(0, 200); } };
const has = (f, re) => { try { return re.test(fs.readFileSync(f, 'utf8')); } catch { return false; } };

const TASKS = [
  { name: 'build a small web page', mode: 'code', prompt: 'Create a small website: index.html that links styles.css and script.js. The page has a heading "Hello Caret" and a button that, when clicked, shows the text "Clicked" in a paragraph with id="out". Make it look clean with a dark background.',
    check: d => has(path.join(d, 'index.html'), /Hello Caret/) && has(path.join(d, 'index.html'), /styles\.css/) && has(path.join(d, 'script.js'), /Clicked/) && fs.existsSync(path.join(d, 'styles.css')) },
  { name: 'fix a bug', mode: 'code', setup: d => { fs.writeFileSync(path.join(d, 'calc.js'), 'function total(items) {\n  let sum = 0;\n  for (let i = 1; i < items.length; i++) sum += items[i].price * items[i].qty;\n  return sum;\n}\nmodule.exports = { total };\n'); fs.writeFileSync(path.join(d, 'run.js'), 'const { total } = require("./calc");\nconsole.log(total([{price:2,qty:3},{price:5,qty:1},{price:1,qty:10}]));\n'); },
    prompt: 'run.js should print 21 but it prints 15. Find the bug and fix it.', check: d => node(d, 'run.js') === '21' },
  { name: 'add a feature', mode: 'code', setup: d => { fs.writeFileSync(path.join(d, 'math.js'), 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n'); fs.writeFileSync(path.join(d, 'run.js'), 'const m = require("./math");\nconsole.log(m.add(2, 3), typeof m.multiply === "function" ? m.multiply(4, 5) : "none");\n'); },
    prompt: 'Add a function multiply(a, b) to math.js and export it. Then run.js should print "5 20".', check: d => node(d, 'run.js') === '5 20' },
  { name: 'explain code (plan mode, no changes)', mode: 'plan', setup: d => { fs.writeFileSync(path.join(d, 'cache.js'), 'const store = new Map();\nfunction get(key, load) {\n  if (store.has(key)) return store.get(key);\n  const v = load(key);\n  store.set(key, v);\n  return v;\n}\nmodule.exports = { get };\n'); },
    prompt: 'What does cache.js do, and what problem could it have if load() throws or returns undefined?', check: (d, ans) => /cache|memo/i.test(ans) && ans.length > 80 && fs.readdirSync(d).join() === 'cache.js' },
  { name: 'rename across two files', mode: 'code', setup: d => { fs.writeFileSync(path.join(d, 'util.js'), 'function fmt(n) { return "$" + n.toFixed(2); }\nmodule.exports = { fmt };\n'); fs.writeFileSync(path.join(d, 'run.js'), 'const { fmt } = require("./util");\nconsole.log(fmt(3.5));\n'); },
    prompt: 'Rename the function fmt to formatPrice everywhere in this project. The program must still print $3.50.', check: d => node(d, 'run.js') === '$3.50' && has(path.join(d, 'util.js'), /formatPrice/) && !has(path.join(d, 'util.js'), /\bfmt\b/) && !has(path.join(d, 'run.js'), /\bfmt\b/) },
];

(async () => {
  const rows = [];
  for (let i = 0; i < TASKS.length; i++) {
    if (only && only !== i + 1) continue;
    const t = TASKS[i];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeble-test-'));
    t.setup && t.setup(dir);
    let answer = '', tools = 0;
    const t0 = Date.now();
    const h = runLocal({ model, mode: t.mode, prompt: t.prompt, cwd: dir, full: true, numCtx: 8192, think,
      on: { text: s => { answer += s; }, thinking() {}, file() {}, tool: ev => { if (ev.status === 'running') tools++; } } });
    const timer = setTimeout(() => h.stop(), 8 * 60 * 1000);
    const r = await h.done; clearTimeout(timer);
    let ok = false; try { ok = !!t.check(dir, answer || r.answer); } catch {}
    const secs = Math.round((Date.now() - t0) / 1000);
    rows.push({ n: i + 1, name: t.name, ok, secs, tools, error: r.error });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${i + 1}. ${t.name}  (${secs}s, ${tools} tool calls)${r.error ? '  error: ' + r.error : ''}`);
    if (!ok) console.log('   answer: ' + (answer || r.answer || '').slice(0, 300).replace(/\n/g, ' ') + '\n   folder: ' + dir);
  }
  console.log(`\n${model}: ${rows.filter(r => r.ok).length}/${rows.length} passed`);
})();
