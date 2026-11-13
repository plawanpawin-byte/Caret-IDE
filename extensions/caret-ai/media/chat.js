(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const logo = document.body.dataset.logo;
  let S = { account: null, models: [], tools: {}, busy: false, last: 'sonnet-5-5', mode: 'code', full: false, root: null };
  let pending = [];   // pasted pictures waiting to be sent (data URLs)
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
      for (const para of seg.split(/\n{2,}/)) {
        const t = para.trim(); if (!t) continue;
        const ls = t.split('\n');
        if (ls.every(l => /^\s*(?:[-*]|\d+[.)])\s+/.test(l))) {
          el.append(h('ul', { class: 'tasks' }, ls.map(l => h('li', {}, inline(l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ''))))));
        } else el.append(h('p', {}, inline(t)));
      }
    });
  }

  const feed = h('div', { class: 'feed' });
  const input = h('textarea', { rows: 1, placeholder: 'Plan, build, ask anything' });
  // A round-cornered menu instead of the system <select> (whose popup is square and cannot be styled).
  const CHEV = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const openMenus = new Set();
  const closeMenus = except => { for (const m of openMenus) if (m !== except) m.close(); };
  document.addEventListener('click', e => { for (const m of openMenus) if (!m.el.contains(e.target)) m.close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
  function dropdown({ cls, title, onpick }) {
    let items = [], value = '';
    const btn = h('button', { class: 'dd ' + cls, type: 'button', title: title || '' });
    const pop = h('div', { class: 'pop', role: 'listbox', hidden: '' });
    const el = h('div', { class: 'ddw' }, btn, pop);
    const api = { el, close() { pop.hidden = true; openMenus.delete(api); } };
    const paint = () => {
      const cur = items.find(i => i.value === value) || items[0];
      btn.replaceChildren(h('span', { text: cur ? cur.label : '' }));
      btn.insertAdjacentHTML('beforeend', CHEV);
      pop.replaceChildren(...items.map(i => h('button', { class: 'opt' + (i.value === value ? ' sel' : ''), type: 'button', role: 'option', onclick: () => { value = i.value; api.close(); paint(); onpick(i.value); } },
        h('span', { class: 'ol' }, h('span', { class: 'on', text: i.label }), i.desc ? h('span', { class: 'od', text: i.desc }) : null),
        h('span', { class: 'ck', text: i.value === value ? '\u2713' : '' }))));
    };
    btn.addEventListener('click', e => { e.stopPropagation(); const open = pop.hidden; closeMenus(api); pop.hidden = !open; if (open) openMenus.add(api); else openMenus.delete(api); });
    Object.defineProperty(el, 'value', { get: () => value, set: v => { value = v; paint(); } });
    el.setItems = list => { items = list; paint(); };
    return el;
  }
  const modelSel = dropdown({ cls: 'plain', title: 'Model', onpick: v => { S.last = v; vscode.postMessage({ type: 'setModel', id: v }); } });
  const modeSel = dropdown({ cls: 'pill', title: 'How the AI works', onpick: v => { S.mode = v; vscode.postMessage({ type: 'setMode', mode: v }); } });
  modeSel.setItems([
    { value: 'plan', label: 'Plan', desc: 'Makes a task list. Changes nothing.' },
    { value: 'code', label: 'Code', desc: 'Writes the code and edits files.' },
    { value: 'agent', label: 'Agent', desc: 'Like Code, with the work split between sub-agents.' },
  ]);
  modeSel.value = 'code';
  const SHIELD = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/></svg>';
  const fullBtn = h('button', { class: 'fullbtn', title: 'Full access: accept everything without asking (writing files, running commands, switching from Plan to Code). Use it in folders you trust.', onclick: () => { S.full = !S.full; vscode.postMessage({ type: 'setFull', full: S.full }); build(); } });
  fullBtn.innerHTML = SHIELD + '<span>Full access</span>';
  const CLIP = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.2-8.2"/></svg>';
  const ctxBtn = h('button', { class: 'tg on', title: 'Include the open file and selection', onclick: () => { ctxOn = !ctxOn; ctxBtn.classList.toggle('on', ctxOn); } });
  ctxBtn.innerHTML = CLIP;
  const sendBtn = h('button', { class: 'send', title: 'Send (Enter)', onclick: () => (S.busy ? vscode.postMessage({ type: 'stop' }) : send()) });
  const SEND = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const STOP = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
  const thumbs = h('div', { class: 'thumbs' });
  const composer = h('div', { class: 'composer' }, thumbs, input, h('div', { class: 'row' }, modeSel, modelSel, h('span', { class: 'grow' }), fullBtn, ctxBtn, sendBtn));
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
    modelSel.setItems(S.models.map(m => ({ value: m.id, label: m.label })));
    modelSel.value = S.last;
    modeSel.value = S.mode;
    fullBtn.classList.toggle('on', !!S.full);
    sendBtn.innerHTML = S.busy ? STOP : SEND; sendBtn.classList.toggle('empty', !S.busy && !input.value.trim() && !pending.length); sendBtn.title = S.busy ? 'Stop' : 'Send (Enter)';
    const missing = [];
    if (!S.tools.claude) missing.push('Claude Code');
    if (!S.tools.codex) missing.push('Codex');
    note.replaceChildren(...(missing.length === 2 ? [h('span', {}, 'Neither ', h('b', { text: 'Claude Code' }), ' nor ', h('b', { text: 'Codex' }), ' was found. Install one (for example "npm i -g @anthropic-ai/claude-code") and sign in with it.')] : []));
  }

  function scroll() { feed.scrollTop = feed.scrollHeight; }
  function drawThumbs() {
    thumbs.replaceChildren(...pending.map((u, i) => h('div', { class: 'th' }, h('img', { src: u, alt: '' }), h('button', { title: 'Remove', onclick: () => { pending.splice(i, 1); drawThumbs(); } }, '\u00d7'))));
    thumbs.classList.toggle('on', pending.length > 0);
    sync();
  }
  function bubble(text, imgs) {
    const el = h('div', { class: 'msg user' });
    if (imgs && imgs.length) el.append(h('div', { class: 'sent' }, imgs.map(u => h('div', { class: 'th' }, h('img', { src: u, alt: '' }),
      h('button', { class: 'reuse', title: 'Use this picture again', onclick: () => { pending.push(u); drawThumbs(); input.focus(); } }, 'Reuse')))));
    if (text) el.append(h('div', { text }));
    return el;
  }
  function send(textArg) {
    const text = (typeof textArg === 'string' ? textArg : input.value).trim();
    if ((!text && !pending.length) || S.busy) return;
    if (feed.querySelector('.hello')) feed.replaceChildren();
    const imgs = pending.slice();
    feed.append(bubble(text, imgs));
    if (typeof textArg !== 'string') { input.value = ''; input.style.height = ''; }
    pending = []; drawThumbs();
    curAi = null; curText = ''; scroll();
    vscode.postMessage({ type: 'send', text: text || 'See the attached picture.', images: imgs, model: modelSel.value, mode: modeSel.value, full: !!S.full, withContext: ctxOn });
  }
  input.addEventListener('paste', e => {
    const items = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file' && /^image\//.test(i.type));
    if (!items.length) return;
    e.preventDefault();
    for (const it of items) {
      const f = it.getAsFile(); if (!f || pending.length >= 6) continue;
      const r = new FileReader();
      r.onload = () => { if (typeof r.result === 'string' && r.result.length < 11e6) { pending.push(r.result); drawThumbs(); } };
      r.readAsDataURL(f);
    }
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  function sync() { sendBtn.classList.toggle('empty', !S.busy && !input.value.trim() && !pending.length); }
  input.addEventListener('input', sync);
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });

  const argText = a => { if (!a) return ''; return a.command || a.file_path || a.path || a.pattern || a.url || a.description || (typeof a === 'string' ? a : ''); };

  window.addEventListener('message', ev => {
    const m = ev.data;
    if (m.type === 'state') { S = { ...S, ...m }; build(); return; }
    if (m.type === 'load') {
      feed.replaceChildren(); tools.clear(); curAi = null;
      for (const x of m.msgs || []) {
        if (x.r === 'user') feed.append(bubble((x.n ? '[' + x.n + ' picture' + (x.n > 1 ? 's' : '') + '] ' : '') + x.t, []));
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
    if (m.type === 'done') {
      if (m.error) feed.append(h('div', { class: 'err', text: m.error }));
      else if (m.plan && S.full) { S.mode = 'code'; modeSel.value = 'code'; vscode.postMessage({ type: 'setMode', mode: 'code' }); send('Go ahead and build the plan above.'); }
      else if (m.plan) {
        const go = mode => { S.mode = mode; modeSel.value = mode; vscode.postMessage({ type: 'setMode', mode }); card.remove(); send('Go ahead and build the plan above.'); };
        const card = h('div', { class: 'plan' }, h('div', { text: 'Plan ready. Switch to a coding mode to build it?' }),
          h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: () => go('code') }, 'Code'), h('button', { class: 'btn ghost', onclick: () => go('agent') }, 'Agent'), h('button', { class: 'btn ghost', onclick: () => card.remove() }, 'Keep planning')));
        feed.append(card);
      }
      curAi = null; scroll();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
