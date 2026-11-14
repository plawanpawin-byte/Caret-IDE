'use strict';
// Runs the real setup path (check Ollama, download base model, create the Aeble alias) against whatever Ollama OLLAMA_HOST points to.
// Usage: OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=D:\x node tools/setuptest.js <alias> <base model> <sizeGB>
const ollama = require('../extensions/caret-ai/lib/ollama');
const [id, base, size] = process.argv.slice(2);
let last = -1;
ollama.setup({ id, label: id, base, sizeGB: Number(size || 1), ctx: 8192 }, r => { const k = r.pct == null ? r.text : Math.floor((r.pct || 0) / 10); if (k !== last) { last = k; console.log(r.text + (r.pct != null ? ' ' + r.pct + '%' : '')); } })
  .then(async () => { const t = await ollama.tags(); console.log('OK, models now:', t.join(', ')); })
  .catch(e => { console.log('FAILED:', e.message); process.exit(1); });
