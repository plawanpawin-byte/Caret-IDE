(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const robloxUrl = document.body.dataset.roblox;
  const GROUPS = ['Source control', 'Cloud and hosting', 'Docs and planning', 'Browser and testing', 'Game development', 'Skills and tools'];
  const SUB = {
    'Source control': 'Repositories, issues and pull requests.', 'Cloud and hosting': 'Deploy and manage your apps and databases.',
    'Docs and planning': 'Current documentation, notes and issue trackers.', 'Browser and testing': 'Let the AI open a browser and check its own work.',
    'Game development': 'Build games from inside their editors.', 'Skills and tools': 'Methods and checkers that make the AI work better.',
  };
  const TINT = {
    cloudflare: ['#f6821f', 'CF'], 'cloudflare-docs': ['#f6821f', 'CD'], supabase: ['#1f8f5f', 'SB'], firebase: ['#f5a300', 'FB'], context7: ['#2a2a2a', 'C7'],
    'sequential-thinking': ['#52525b', 'ST'], notion: ['#2b2b2b', 'N'], linear: ['#5e6ad2', 'LN'], playwright: ['#2e7d32', 'PW'], 'chrome-devtools': ['#1a73e8', 'DT'],
    superpowers: ['#52525b', 'SP'], aislop: ['#52525b', 'AS'], rea: ['#52525b', 'RE'],
  };
  const GH = 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';

  let data = { claude: true, items: [] };
  let view = 'market', before = 'market', current = null, query = '', token = '';
  const working = new Map(), lastLine = new Map(), failed = new Map();

  const h = (tag, props, ...kids) => {
    const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.setAttribute('class', v); else if (k === 'text') el.textContent = v; else if (k === 'style') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  };

  function avatar(id, size) {
    const base = { width: size + 'px', height: size + 'px', borderRadius: Math.round(size * .24) + 'px' };
    if (id === 'roblox-studio') return h('img', { class: 'ico', src: robloxUrl, alt: '', style: base });
    if (id === 'github-mcp') {
      const sz = Math.round(size * .6);
      return h('span', { class: 'ico', style: { ...base, background: '#000', border: '1px solid #2a2723' } },
        h('svg', { viewBox: '0 0 24 24', width: sz, height: sz, fill: '#fff' }, h('path', { d: GH })));
    }
    const [bg, txt] = TINT[id] || ['#444', '?'];
    return h('span', { class: 'ico', style: { ...base, background: bg, fontSize: Math.round(size * .36) + 'px' }, text: txt });
  }

  const matches = i => !query || (i.name + ' ' + i.summary + ' ' + i.by + ' ' + (i.group || '')).toLowerCase().includes(query);
  const openDetail = id => { if (view !== 'detail') before = view; current = id; token = ''; view = 'detail'; render(); };
  const install = i => { if (working.has(i.id)) return; working.set(i.id, 'install'); lastLine.delete(i.id); failed.delete(i.id); vscode.postMessage({ type: 'install', id: i.id, token }); render(); };
  const remove = i => { if (working.has(i.id)) return; working.set(i.id, 'uninstall'); lastLine.delete(i.id); failed.delete(i.id); vscode.postMessage({ type: 'uninstall', id: i.id }); render(); };

  function card(i) {
    const w = working.get(i.id);
    return h('button', { class: 'card', onclick: () => openDetail(i.id) }, avatar(i.id, 44),
      h('span', { class: 'main' }, h('span', { class: 'name', text: i.name }), h('span', { class: 'sum', text: i.summary })),
      h('span', { class: 'tail' + (i.installed ? ' ok' : ''), text: w ? '…' : i.installed ? '✓' : '+' }));
  }
  function feature() {
    const i = data.items.find(x => x.id === 'github-mcp');
    if (!i || query) return null;
    const ids = ['github-mcp', 'cloudflare', 'supabase', 'linear', 'notion', 'playwright'];
    return h('div', { class: 'feature' }, h('div', { class: 'art' }, ...ids.map((id, k) => h('div', { class: 'float f' + k }, avatar(id, 54)))),
      h('div', { class: 'fmain' }, h('div', { class: 'kicker', text: 'Featured' }), h('div', { class: 'ftitle', text: i.name }),
        h('p', { text: 'Let the AI work with your repositories, issues and pull requests, using the GitHub account you signed in with.' }),
        h('div', { class: 'actions' }, i.installed ? h('span', { class: 'ok', text: '✓ Installed' }) : h('button', { class: 'btn blue', text: '+ Add', onclick: () => { current = i.id; install(i); openDetail(i.id); } }),
          h('button', { class: 'btn', text: 'Details', onclick: () => openDetail(i.id) }))));
  }
  function market() {
    const shown = data.items.filter(matches), out = [];
    if (!data.claude) out.push(h('div', { class: 'note', text: 'Claude Code is not installed yet. Connectors work through it: install it first.' }));
    const f = feature(); if (f) out.push(f);
    for (const g of GROUPS) {
      const list = shown.filter(i => (i.group || 'Skills and tools') === g);
      if (list.length) out.push(h('section', { class: 'group' }, h('h2', { text: g }), h('p', { text: SUB[g] }), h('div', { class: 'grid' }, ...list.map(card))));
    }
    if (!shown.length) out.push(h('div', { class: 'none', text: 'No connector matches.' }));
    return out;
  }
  function installed() {
    const list = data.items.filter(i => i.installed && matches(i));
    return list.length ? [h('div', { class: 'grid', style: { marginTop: '20px' } }, ...list.map(card))] : [h('div', { class: 'none', text: 'Nothing installed yet. Open the Marketplace and add one.' })];
  }
  function detail() {
    const i = data.items.find(x => x.id === current);
    if (!i) return [h('div', { class: 'none', text: 'Choose a connector.' })];
    const w = working.get(i.id);
    const own = i.needsToken && i.id !== 'github-mcp' && !i.installed;
    const tokenBox = own ? h('div', { class: 'token' }, h('label', { text: i.tokenLabel || 'Your key' }),
      h('input', { type: 'password', placeholder: 'Paste your own key', value: token, autocomplete: 'off', spellcheck: 'false', oninput: e => { token = e.target.value; } }),
      h('div', { class: 'hint', text: (i.tokenHint ? i.tokenHint + ' ' : '') + 'Your own key. It is passed to Claude Code and kept on this computer only.' })) : null;
    const action = w ? h('button', { class: 'btn blue', disabled: true, text: w === 'install' ? 'Installing…' : 'Removing…' })
      : i.installed ? h('button', { class: 'btn', text: 'Remove', onclick: () => remove(i) })
        : h('button', { class: 'btn blue', disabled: !!i.blocked, text: '+ Add', onclick: () => install(i) });
    const fact = (k, v) => h('div', { class: 'fact' }, h('div', { class: 'k', text: k }), h('div', { text: v }));
    return [
      h('button', { class: 'back', text: '‹ Back', onclick: () => { view = before; render(); } }),
      h('div', { class: 'hero' }, avatar(i.id, 84), h('div', {},
        h('h1', { text: i.name }), h('div', { class: 'by', text: i.by }), h('p', { class: 'hsum', text: i.summary }),
        h('div', { class: 'actions' }, action, i.installed ? h('span', { class: 'ok', text: '✓ Connected' }) : null),
        i.blocked && !i.installed ? h('div', { class: 'err', text: i.blocked }) : null, tokenBox,
        failed.get(i.id) ? h('div', { class: 'err', text: failed.get(i.id) }) : null,
        h('div', { class: 'log', text: w ? (lastLine.get(i.id) || 'Working…') : '' }))),
      h('div', { class: 'cols' },
        h('div', { class: 'text' }, ...i.about.map(t => h('p', { text: t })), h('h3', { text: 'What it does' }), h('ul', {}, ...i.features.map(f => h('li', { text: f })))),
        h('div', { class: 'facts' }, h('h4', { text: 'Details' }), fact('Group', i.group || i.category), fact('Source', i.repo), fact('Works with', 'Claude Code'),
          fact('Key', i.needsToken ? (i.id === 'github-mcp' ? 'Your GitHub sign-in' : 'Your own, kept on this PC') : 'None needed'))),
    ];
  }

  const search = h('input', { class: 'search', placeholder: 'Search connectors…', spellcheck: 'false', oninput: e => { query = e.target.value.trim().toLowerCase(); if (view === 'detail') view = before; render(true); } });
  const seg = h('div', { class: 'seg' });
  const body = h('div', {});
  app.append(h('div', { class: 'wrap' }, h('div', { class: 'head' }, h('h1', { text: 'Connectors' }), seg), search, body));

  function render(keepFocus) {
    seg.replaceChildren(...[['market', 'Marketplace'], ['installed', 'Installed']].map(([k, t]) =>
      h('button', { class: (view === k || (view === 'detail' && before === k)) ? 'on' : '', text: t, onclick: () => { view = k; before = k; render(); } })));
    body.replaceChildren(...(view === 'detail' ? detail() : view === 'installed' ? installed() : market()));
  }

  window.addEventListener('message', ev => {
    const m = ev.data;
    if (m.type === 'status') { data = m.data; render(); }
    else if (m.type === 'progress') { lastLine.set(m.id, m.line); const l = document.querySelector('.log'); if (l && m.id === current) l.textContent = m.line; }
    else if (m.type === 'done') { working.delete(m.id); }
    else if (m.type === 'failed') { working.delete(m.id); if (m.id) failed.set(m.id, m.error); }
  });
  render();
  vscode.postMessage({ type: 'ready' });
})();
