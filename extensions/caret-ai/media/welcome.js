(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const logo = document.body.dataset.logo;
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  };
  const icon = (d, fill) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', fill ? '0 0 16 16' : '0 0 24 24');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); if (fill) p.setAttribute('fill', 'currentColor'); s.append(p); return s;
  };
  const GH = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z';

  function login() {
    const btn = h('button', { class: 'gh', onclick: () => { btn.disabled = true; btn.lastChild.textContent = 'Finish in your browser…'; vscode.postMessage({ type: 'login' }); } },
      icon(GH, true), h('span', { text: 'Continue with GitHub' }));
    app.replaceChildren(h('div', { class: 'login' },
      h('div', { class: 'glow' }),
      h('img', { class: 'big', src: logo, alt: '' }),
      h('h1', { text: 'Caret IDE' }),
      h('p', { class: 'sub', text: 'The free IDE. No subscription.' }),
      btn,
      h('p', { class: 'fine', text: 'You sign in on the website with GitHub. We read your username and avatar, nothing else.' })));
  }

  const tile = (label, d, type, main) => h('button', { class: 'tile' + (main ? ' main' : ''), onclick: () => vscode.postMessage({ type }) }, icon(d), h('span', { text: label }));

  function home(account, items) {
    const list = h('div', { class: 'recent' }, h('h2', { text: 'Recent projects' }),
      ...(items.length ? items.map(i => h('button', { class: 'item', title: i.uri, onclick: () => vscode.postMessage({ type: 'open', uri: i.uri }) },
        h('span', { class: 'n', text: i.name }), h('span', { class: 'd', text: '‎' + i.dir }))) : [h('div', { class: 'none', text: 'None yet' })]));
    app.replaceChildren(h('div', { class: 'wrap' },
      h('img', { class: 'logo', src: logo, alt: '' }),
      h('h1', { text: account ? `Hey ${account.login}` : 'Caret IDE' }),
      h('p', { class: 'sub', text: 'What should we build today?' }),
      h('div', { class: 'tiles' },
        tile('Open project', 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'openFolder', true),
        tile('Clone repo', 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9', 'clone'),
        tile('New file', 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 12v5M9.5 14.5h5', 'newFile')),
      list));
  }

  window.addEventListener('message', e => {
    const m = e.data;
    if (m?.type !== 'state') return;
    if (m.account) home(m.account, m.items || []); else login();
  });
  vscode.postMessage({ type: 'ready' });
})();
