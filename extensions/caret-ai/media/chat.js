(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const logo = document.body.dataset.logo;
  let S = { account: null, models: [], tools: {}, busy: false, last: 'claude:default', mode: 'edit', root: null };
  let ctxOn = true;
  let curAi = null, curText = '';
  const tools = new Map();

  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  };

  // ---- a small, safe markdown: paragraphs, ``` code ```, `inline`, **bold** (everything goes in as text) ----
  function inline(text) {
    const out = document.createDocumentFragment();
    for (const part of text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/)) {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) out.append(h('code', { text: part.slice(1, -1) }));
      else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) out.append(h('b', { text: part.slice(2, -2) }));
      else out.append(part);
    }
    return out;
  }
  function render(el, text) {
    el.replaceChildren();
    const segs = text.split(/```/);
    segs.forEach((seg, i) => {
      if (i % 2) { el.append(h('pre', {}, h('code', { text: seg.replace(/^[^\n]*\n/, '') }))); return; }
      for (const para of seg.split(/\n{2,}/)) { if (para.trim()) el.append(h('p', {}, inline(para.trim()))); }
    });
  }

  const feed = h('div', { class: 'feed' });
  const input = h('textarea', { rows: 1, placeholder: 'Ask anything, / for actions' });
  const modelSel = h('select', { title: 'Model', onchange: e => { S.last = e.target.value; vscode.postMessage({ type: 'setModel', id: S.last }); } });
  const modeSel = h('select', { title: 'How the AI works', onchange: e => { S.mode = e.target.value; vscode.postMessage({ type: 'setMode', mode: S.mode }); } },
    h('option', { value: 'plan', text: 'Plan (read only)' }), h('option', { value: 'edit', text: 'Edit' }), h('option', { value: 'auto', text: 'Full access' }));
  const ctxBtn = h('button', { class: 'tg on', title: 'Include the open file and selection', text: '@ file', onclick: () => { ctxOn = !ctxOn; ctxBtn.classList.toggle('on', ctxOn); } });
  const sendBtn = h('button', { class: 'send', title: 'Send (Enter)', onclick: () => (S.busy ? vscode.postMessage({ type: 'stop' }) : send()) });
  const SEND = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const STOP = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
  const composer = h('div', { class: 'composer' }, input, h('div', { class: 'row' }, modelSel, modeSel, h('span', { class: 'grow' }), ctxBtn, sendBtn));
  const note = h('div', { class: 'note' });

  function hello() {
    const who = S.account?.login;
    feed.replaceChildren(h('div', { class: 'hello' }, h('img', { src: logo, alt: '' }),
      h('h1', { text: who ? `Hey ${who}, what should we build today?` : 'Caret IDE' }),
      S.root ? null : h('p', { text: 'Open a folder to start (File, Open Folder).' })));
  }

  function gate() {
    app.replaceChildren(h('div', { class: 'feed' }, h('div', { class: 'hello' }, h('img', { src: logo, alt: '' }),
      h('h1', { text: 'The free IDE. No subscription.' }),
      h('button', { class: 'btn', text: 'Log In', onclick: e => { e.target.disabled = true; e.target.textContent = 'Finish in your browser…'; vscode.postMessage({ type: 'login' }); } }),
      h('p', { text: 'You sign in on the website with GitHub.' }))));
  }

  function build() {
    if (!S.account) { gate(); return; }
    if (!app.contains(feed)) {
      app.replaceChildren(
        h('div', { class: 'head' }, h('span', { class: 't', text: 'Caret AI' }),
          h('button', { class: 'ib', title: 'New chat (Ctrl+Shift+L)', text: '+', onclick: () => vscode.postMessage({ type: 'newChat' }) }),
          h('button', { class: 'ib', title: 'Log out', text: 'Log out', onclick: () => vscode.postMessage({ type: 'logout' }) })),
        feed, note, composer);
      if (!feed.childElementCount) hello();
    }
    modelSel.replaceChildren(...S.models.map(m => h('option', { value: m.id, text: m.label, selected: m.id === S.last })));
    modeSel.value = S.mode;
    sendBtn.innerHTML = S.busy ? STOP : SEND; sendBtn.title = S.busy ? 'Stop' : 'Send (Enter)';
    const missing = [];
    if (!S.tools.claude) missing.push('Claude Code');
    if (!S.tools.codex) missing.push('Codex');
    note.replaceChildren(...(missing.length === 2 ? [h('span', {}, 'Neither ', h('b', { text: 'Claude Code' }), ' nor ', h('b', { text: 'Codex' }), ' was found. Install one (for example "npm i -g @anthropic-ai/claude-code") and sign in with it.')] : []));
  }

  function scroll() { feed.scrollTop = feed.scrollHeight; }
  function send() {
    const text = input.value.trim();
    if (!text || S.busy) return;
    if (feed.querySelector('.hello')) feed.replaceChildren();
    feed.append(h('div', { class: 'msg user', text }));
    input.value = ''; input.style.height = '';
    curAi = null; curText = ''; scroll();
    vscode.postMessage({ type: 'send', text, model: modelSel.value, mode: modeSel.value, withContext: ctxOn });
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; });

  const argText = a => { if (!a) return ''; return a.command || a.file_path || a.path || a.pattern || a.url || a.description || (typeof a === 'string' ? a : ''); };

  window.addEventListener('message', ev => {
    const m = ev.data;
    if (m.type === 'state') { S = { ...S, ...m }; build(); return; }
    if (m.type === 'cleared') { feed.replaceChildren(); hello(); tools.clear(); return; }
    if (m.type === 'error') { feed.append(h('div', { class: 'err', text: m.text })); scroll(); return; }
    if (m.type === 'start') { curAi = null; curText = ''; return; }
    if (m.type === 'text') {
      if (!curAi) { curAi = h('div', { class: 'msg ai' }); feed.append(curAi); curText = ''; }
      curText += (curText ? '\n\n' : '') + m.text; render(curAi, curText); scroll(); return;
    }
    if (m.type === 'tool') {
      const t = m.tool; let el = tools.get(t.id);
      if (!el) {
        el = h('details', { class: 'tool running' }, h('summary', {}, h('span', { class: 'dot' }), h('span', { class: 'nm', text: t.name || 'tool' }), h('span', { class: 'ar', text: argText(t.args) })));
        tools.set(t.id, el); feed.append(el); curAi = null;
      }
      el.classList.remove('running', 'done', 'error'); el.classList.add(t.status || 'running');
      if (t.result) { el.querySelector('pre')?.remove(); el.append(h('pre', { text: t.result })); }
      scroll(); return;
    }
    if (m.type === 'file') {
      feed.append(h('div', {}, h('span', { class: 'chip', title: 'Open', text: m.path, onclick: () => vscode.postMessage({ type: 'openFile', path: m.path }) }))); curAi = null; scroll(); return;
    }
    if (m.type === 'done') { if (m.error) feed.append(h('div', { class: 'err', text: m.error })); curAi = null; scroll(); }
  });

  vscode.postMessage({ type: 'ready' });
})();
