// Drives lib/runners.js exactly as the extension does, outside VS Code.
const path = require('path'), fs = require('fs'), os = require('os');
const cli = require(__dirname + '/../extensions/caret-ai/lib/cli');
const { runClaude } = require(__dirname + '/../extensions/caret-ai/lib/runners');
cli.fixPath();
const [, , model, mode, ...rest] = process.argv;
const prompt = rest.join(' ');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caret-run-'));
console.log('cwd', dir, 'model', model, 'mode', mode);
const ev = [];
const r = runClaude({ model, mode, prompt, system: process.env.SYS || 'You are the coding assistant inside Caret IDE. Be concise.', cwd: dir, addDirs: [],
  on: { text: t => ev.push('TEXT ' + JSON.stringify(t.slice(0, 300))), tool: t => ev.push('TOOL ' + t.name + ' ' + t.status + (t.args && t.args.todos ? ' todos=' + t.args.todos.length : '')), thinking: t => ev.push('THINK ' + t.slice(0, 60)), file: f => ev.push('FILE ' + f) } });
const t = setTimeout(() => { console.log('TIMEOUT'); r.stop(); }, 150000);
r.done.then(res => { clearTimeout(t); console.log(ev.join('\n')); console.log('RESULT', JSON.stringify(res)); console.log('FILES', fs.readdirSync(dir)); process.exit(0); });
