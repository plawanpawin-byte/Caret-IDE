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

  const tile = (label, d, type, main) => h('button', { class: 'tile' + (main ? ' main' : ''), onclick: () => vscode.postMessage({ type }) }, icon(d), h('span', { text: label }));

  function home(account, items) {
    const list = h('div', { class: 'recent' }, h('h2', { text: 'Recent projects' }),
      ...(items.length ? items.map(i => h('button', { class: 'item', title: i.uri, onclick: () => vscode.postMessage({ type: 'open', uri: i.uri }) },
        h('span', { class: 'n', text: i.name }), h('span', { class: 'd', text: '‎' + i.dir }))) : [h('div', { class: 'none', text: 'None yet' })]));
    app.replaceChildren(h('div', { class: 'wrap' },
      h('img', { class: 'logo', src: logo, alt: '' }),
      h('h1', { text: account ? `Hey ${account.login}` : 'CaretStudio' }),
      h('p', { class: 'sub', text: 'What should we build today?' }),
      h('div', { class: 'tiles' },
        tile('Open project', 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'openFolder', true),
        tile('Clone repo', 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9', 'clone'),
        tile('Connect via SSH', 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 10l3 2-3 2M12 15h4', 'ssh')),
      list));
  }

  // First run: what you do, your OpenRouter key, which models show in the chat menu.
  const U = window.CaretUI;
  const setup = { step: 0, role: '', ai: null, account: null, items: [] };
  const dots = n => h('div', { class: 'steps' }, ...[0, 1, 2].map(i => h('i', { class: i === n ? 'on' : '' })));
  const frame = (n, title, sub, body, foot) => app.replaceChildren(h('div', { class: 'setup' }, dots(n), h('h2', { class: 'st', text: title }), h('p', { class: 'ss', text: sub }), body, foot));

  function roleStep() {
    let pick = setup.role;
    const next = h('button', { class: 'btn2', text: 'Continue', onclick: () => { setup.role = pick; vscode.postMessage({ type: 'saveRole', role: pick }); setup.step = 1; wizard(); } });
    next.disabled = !pick;
    const cards = U.ROLES.map(r => { const c = h('button', { class: 'role' + (r.id === pick ? ' on' : ''), type: 'button', onclick: () => { pick = r.id; next.disabled = false; cards.forEach(x => x.el.classList.toggle('on', x.id === r.id)); } }, U.svg(r.d), h('span', { text: r.label })); return { id: r.id, el: c }; });
    frame(0, 'What best describes your work?', 'This helps us tune Caret for you.', h('div', { class: 'roles' }, cards.map(c => c.el)),
      h('div', { class: 'foot' }, next, h('button', { class: 'btn2 ghost', text: 'Skip', onclick: () => { setup.step = 1; wizard(); } })));
  }

  function keyStep() {
    const input = h('input', { class: 'field', type: 'password', placeholder: 'sk-or-...', autocomplete: 'off', spellcheck: 'false' });
    const err = h('p', { class: 'err' });
    const next = h('button', { class: 'btn2', text: 'Next' });
    next.disabled = true;
    input.addEventListener('input', () => { next.disabled = !input.value.trim(); err.textContent = ''; });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !next.disabled) next.click(); });
    next.addEventListener('click', () => { next.disabled = true; next.textContent = 'Checking…'; setup.pending = { next, err, input }; vscode.postMessage({ type: 'saveKey', key: input.value }); });
    const how = h('ol', { class: 'how' },
      h('li', {}, 'Open OpenRouter and sign in (it is free to join).'),
      h('li', {}, 'Go to Keys and press Create Key.'),
      h('li', {}, 'Copy the key and paste it below.'));
    frame(1, 'Set up your AI', 'Caret talks to Claude, GPT and Gemini through OpenRouter. You pay OpenRouter directly for what you use.',
      h('div', { class: 'keybox' }, how, h('button', { class: 'btn2 ghost', text: 'Open OpenRouter keys', onclick: () => vscode.postMessage({ type: 'link', name: 'keys' }) }), input, err),
      h('div', { class: 'foot' }, next, h('button', { class: 'btn2 ghost', text: 'Later', onclick: () => { setup.step = 2; wizard(); } })));
    setTimeout(() => input.focus(), 50);
  }

  function modelStep() {
    const ai = setup.ai;
    const body = ai ? U.modelList({ models: ai.models, enabled: ai.enabled, onChange: ids => vscode.postMessage({ type: 'setEnabled', ids }) }) : h('div', { class: 'none', text: 'Loading models…' });
    frame(2, 'Choose your models', 'These show in the chat menu. You can change them later in Settings, AI.', body,
      h('div', { class: 'foot' }, h('button', { class: 'btn2', text: 'Done', onclick: () => vscode.postMessage({ type: 'finishSetup' }) })));
    if (!ai) vscode.postMessage({ type: 'aiState' });
  }

  function wizard() { [roleStep, keyStep, modelStep][setup.step](); }

  window.addEventListener('message', e => {
    const m = e.data;
    if (m?.type === 'ai') { setup.ai = m; if (setup.step === 2 && setup.active) modelStep(); return; }
    if (m?.type === 'keyResult') { const p = setup.pending; if (!p) return; if (m.ok) { setup.step = 2; setup.pending = null; setup.ai = null; wizard(); } else { p.err.textContent = m.error || 'That key did not work.'; p.next.textContent = 'Next'; p.next.disabled = !p.input.value.trim(); } return; }
    if (m?.type !== 'state') return;
    setup.account = m.account; setup.items = m.items || [];
    if (m.onboarded) { setup.active = false; home(m.account, m.items || []); return; }
    if (!setup.active) { setup.active = true; setup.step = 0; wizard(); }
  });
  vscode.postMessage({ type: 'ready' });
})();
