(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  };
  const icon = d => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); s.append(p); return s;
  };
  const tile = (label, d, type, main) => h('button', { class: 'tile' + (main ? ' main' : ''), onclick: () => vscode.postMessage({ type }) }, icon(d), h('span', { text: label }));
  const list = h('div', { class: 'recent' }, h('h2', { text: 'Recent projects' }), h('div', { class: 'none', text: 'None yet' }));
  app.append(h('div', { class: 'wrap' },
    h('img', { class: 'logo', src: document.body.dataset.logo, alt: '' }),
    h('h1', { text: 'Caret IDE' }),
    h('p', { class: 'sub', text: 'The free IDE. No subscription.' }),
    h('div', { class: 'tiles' },
      tile('Open project', 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'openFolder'),
      tile('Clone repo', 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9', 'clone'),
      tile('New file', 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 12v5M9.5 14.5h5', 'newFile'),
      tile('Log in', 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3', 'login', true)),
    list));
  window.addEventListener('message', e => {
    if (e.data?.type !== 'recent' || !e.data.items.length) return;
    list.replaceChildren(h('h2', { text: 'Recent projects' }), ...e.data.items.map(i =>
      h('button', { class: 'item', title: i.uri, onclick: () => vscode.postMessage({ type: 'open', uri: i.uri }) },
        h('span', { class: 'n', text: i.name }), h('span', { class: 'd', text: '‎' + i.dir }))));
  });
  vscode.postMessage({ type: 'ready' });
})();
