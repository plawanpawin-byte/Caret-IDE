const { spawn } = require('child_process');
const exe = require('path').join(__dirname, '..', 'dist', 'Caret-IDE', 'Caret IDE.exe');
const sp = require('os').tmpdir();
const p = spawn(exe, ['--remote-debugging-port=9333', '--user-data-dir=' + sp + '/cide-ud9', '--extensions-dir=' + sp + '/cide-ext9', '--disable-workspace-trust', 'D:/carnet-web'], { env: { ...process.env, CARET_FAKE: '1' }, stdio: 'ignore' });
(async () => {
  await new Promise(r => setTimeout(r, 12000));
  try {
    const list = await (await fetch('http://127.0.0.1:9333/json')).json();
    const t = list.find(x => x.type === 'page' && /workbench\.html/.test(x.url));
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    const expr = process.argv[2];
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    ws.onmessage = m => { const j = JSON.parse(m.data); if (j.id === 1) { console.log(JSON.stringify(j.result.result.value, null, 1)); ws.close(); p.kill(); setTimeout(() => process.exit(0), 300); } };
  } catch (e) { console.log('ERR', e.message); p.kill(); process.exit(1); }
})();
