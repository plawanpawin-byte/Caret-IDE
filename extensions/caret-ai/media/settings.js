(function () {
  const vscode = acquireVsCodeApi();
  const { h, ROLES, modelList } = window.CaretUI;
  const app = document.getElementById('app');
  let S = null, section = document.body.dataset.section || 'profile';

  // Profile and AI are pages here. The rest are the names from the gear menu; each opens the stock VS Code screen.
  const PAGES = [['profile', 'Profile'], ['ai', 'AI']];
  const OPEN = [['palette', 'Command Palette'], ['profiles', 'Profiles'], ['settings', 'Settings'], ['extensions', 'Extensions'], ['keys', 'Keyboard Shortcuts'], ['snippets', 'Snippets'], ['tasks', 'Tasks'], ['themes', 'Themes'], ['density', 'Layout Density']];

  const row = (label, sub, control) => h('div', { class: 'srow' }, h('div', { class: 'sl' }, h('div', { class: 'sn', text: label }), sub ? h('div', { class: 'sd', text: sub }) : null), h('div', { class: 'sc' }, control));

  function profile() {
    const a = S.account;
    const sel = h('select', { class: 'sel', onchange: e => vscode.postMessage({ type: 'saveRole', role: e.target.value }) }, h('option', { value: '', text: 'Choose…' }), ...ROLES.map(r => h('option', { value: r.id, text: r.label })));
    sel.value = S.role || '';
    const upd = h('select', { class: 'sel', onchange: e => vscode.postMessage({ type: 'setAutoUpdate', on: e.target.value === 'on' }) }, h('option', { value: 'on', text: 'On' }), h('option', { value: 'off', text: 'Off' }));
    upd.value = S.autoUpdate === false ? 'off' : 'on';
    return [h('h2', { text: 'Profile' }),
      row('Name', 'The user name of this computer.', h('div', { class: 'val', text: a ? a.login : '' })),
      row('What best describes your work?', null, sel),
      h('h3', { text: 'Your data' }),
      row('Stored on this computer', 'Chats, settings and your OpenRouter key stay on this computer. Nothing is stored in the cloud. What you send to the AI goes to OpenRouter, using your key.', null),
      h('h3', { text: 'About' }),
      row('CaretStudio ' + (S.version || ''), 'Looks at GitHub for a new version and offers to install it. Nothing about you is sent.', h('button', { class: 'btn2', type: 'button', text: 'Check for updates', onclick: () => vscode.postMessage({ type: 'checkUpdate' }) })),
      row('Update automatically', 'Check for a new version when CaretStudio starts.', upd),
      row('Send feedback', 'Opens a page on GitHub where you can describe a problem or an idea.', h('button', { class: 'btn2', type: 'button', text: 'Send feedback', onclick: () => vscode.postMessage({ type: 'feedback' }) }))];
  }

  function aiPage() {
    const input = h('input', { class: 'field', type: 'password', placeholder: S.hasKey ? 'Paste a new key to replace it' : 'sk-or-...', autocomplete: 'off', spellcheck: 'false' });
    const err = h('p', { class: 'err' });
    const save = h('button', { class: 'btn2', text: S.hasKey ? 'Change key' : 'Save key' });
    save.disabled = true;
    input.addEventListener('input', () => { save.disabled = !input.value.trim(); err.textContent = ''; });
    save.addEventListener('click', () => { save.disabled = true; save.textContent = 'Checking…'; S.pendingKey = { err, save, input }; vscode.postMessage({ type: 'saveKey', key: input.value }); });
    const ctl = h('div', { class: 'keyctl' }, h('div', { class: 'keyrow' }, input, save), err,
      h('div', { class: 'keylinks' },
        h('button', { class: 'link', type: 'button', text: 'Get a key', onclick: () => vscode.postMessage({ type: 'link', name: 'keys' }) }),
        h('button', { class: 'link', type: 'button', text: 'Add credits', onclick: () => vscode.postMessage({ type: 'link', name: 'credits' }) }),
        S.hasKey ? h('button', { class: 'link danger', type: 'button', text: 'Remove key', onclick: () => vscode.postMessage({ type: 'removeKey' }) }) : null));
    return [h('h2', { text: 'AI' }),
      row('OpenRouter API key', S.hasKey ? 'Saved on this computer: ' + S.masked : 'Not set. Caret needs a key to talk to the models.', null),
      h('div', { class: 'srow wide' }, ctl),
      h('h3', { text: 'Models in the chat menu' }),
      modelList({ models: S.models, enabled: S.enabled, onChange: ids => { S.enabled = ids; vscode.postMessage({ type: 'setEnabled', ids }); } })];
  }

  function draw() {
    if (!S) return;
    const nav = h('nav', { class: 'nav' },
      ...PAGES.map(([id, label]) => h('button', { class: 'ni' + (id === section ? ' on' : ''), type: 'button', text: label, onclick: () => { section = id; draw(); } })),
      h('div', { class: 'sep' }),
      ...OPEN.map(([id, label]) => h('button', { class: 'ni open', type: 'button', title: 'Opens the ' + label + ' screen', onclick: () => vscode.postMessage({ type: 'cmd', name: id }) }, h('span', { text: label }), h('span', { class: 'ar', text: '↗' }))));
    const body = h('div', { class: 'body' }, ...(section === 'ai' ? aiPage() : profile()));
    app.replaceChildren(h('div', { class: 'shell' }, h('div', { class: 'head', text: 'Settings' }), h('div', { class: 'cols' }, nav, body)));
  }

  window.addEventListener('message', e => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'goto') { section = m.section === 'ai' ? 'ai' : 'profile'; draw(); return; }
    if (m.type === 'keyResult') { const p = S && S.pendingKey; if (p && !m.ok) { p.err.textContent = m.error || 'That key did not work.'; p.save.textContent = 'Change key'; p.save.disabled = !p.input.value.trim(); } return; }
    if (m.type === 'settings' || m.type === 'ai') { S = { ...(S || {}), ...m, type: 'settings' }; draw(); }
  });
  vscode.postMessage({ type: 'ready' });
})();
