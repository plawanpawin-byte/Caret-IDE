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
  const input = h('textarea', { rows: 1, placeholder: 'Plan, build, ask anything' });
  const modelSel = h('select', { class: 'plain', title: 'Model', onchange: e => { S.last = e.target.value; vscode.postMessage({ type: 'setModel', id: S.last }); } });
  const modeSel = h('select', { class: 'pill', title: 'Plan: read only. Agent: edits files. Full access: runs anything.', onchange: e => { S.mode = e.target.value; vscode.postMessage({ type: 'setMode', mode: S.mode }); } },
    h('option', { value: 'plan', text: 'Plan' }), h('option', { value: 'edit', text: 'Agent' }), h('option', { value: 'auto', text: 'Full access' }));
  const CLIP = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.2-8.2"/></svg>';
  const ctxBtn = h('button', { class: 'tg on', title: 'Include the open file and selection', onclick: () => { ctxOn = !ctxOn; ctxBtn.classList.toggle('on', ctxOn); } });
  ctxBtn.innerHTML = CLIP;
  const sendBtn = h('button', { class: 'send', title: 'Send (Enter)', onclick: () => (S.busy ? vscode.postMessage({ type: 'stop' }) : send()) });
  const SEND = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const STOP = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
  const composer = h('div', { class: 'composer' }, input, h('div', { class: 'row' }, modeSel, modelSel, h('span', { class: 'grow' }), ctxBtn, sendBtn));
  const note = h('div', { class: 'note' });

  function hello() {
    const who = S.account?.login;
    feed.replaceChildren(h('div', { class: 'hello' }, h('img', { src: logo, alt: '' }),
      h('h1', { text: who ? `Hey ${who}, what should we build today?` : 'Caret IDE' }),
      S.root ? null : h('p', { text: 'Open a folder to start (File, Open Folder).' })));
  }

  function build() {
    if (!app.contains(feed)) {
      app.replaceChildren(
        feed, note, composer);
      if (!feed.childElementCount) hello();
    }
    modelSel.replaceChildren(...S.models.map(m => h('option', { value: m.id, text: m.label, selected: m.id === S.last })));
    modeSel.value = S.mode;
    sendBtn.innerHTML = S.busy ? STOP : SEND; sendBtn.classList.toggle('empty', !S.busy && !input.value.trim()); sendBtn.title = S.busy ? 'Stop' : 'Send (Enter)';
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
    input.value = ''; input.style.height = ''; sendBtn.classList.add('empty');
    curAi = null; curText = ''; scroll();
    vscode.postMessage({ type: 'send', text, model: modelSel.value, mode: modeSel.value, withContext: ctxOn });
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  const sync = () => sendBtn.classList.toggle('empty', !S.busy && !input.value.trim());
  input.addEventListener('input', sync);
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; });

  const argText = a => { if (!a) return ''; return a.command || a.file_path || a.path || a.pattern || a.url || a.description || (typeof a === 'string' ? a : ''); };

  window.addEventListener('message', ev => {
    const m = ev.data;
    if (m.type === 'state') { S = { ...S, ...m }; build(); return; }
    if (m.type === 'load') {
      feed.replaceChildren(); tools.clear(); curAi = null;
      for (const x of m.msgs || []) {
        if (x.r === 'user') feed.append(h('div', { class: 'msg user', text: x.t }));
        else if (x.r === 'ai') { const el = h('div', { class: 'msg ai' }); render(el, x.t); feed.append(el); }
        else if (x.r === 'tool') {
          const el = h('details', { class: 'tool ' + (x.status === 'error' ? 'error' : 'done') }, h('summary', {}, h('span', { class: 'dot' }), h('span', { class: 'nm', text: x.name || 'tool' }), h('span', { class: 'ar', text: argText(x.args) })));
          if (x.result) el.append(h('pre', { text: x.result }));
          feed.append(el);
        }
      }
      scroll(); return;
    }
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
