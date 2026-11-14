// Small pieces shared by the setup screens and the Settings page.
(function () {
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  };
  const svg = d => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); s.append(p); return s;
  };

  const ROLES = [
    { id: 'engineer', label: 'Software engineer', d: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16' },
    { id: 'student', label: 'Student', d: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5' },
    { id: 'designer', label: 'Designer', d: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' },
    { id: 'data', label: 'Data or AI', d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
    { id: 'founder', label: 'Founder or product', d: 'M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z' },
    { id: 'hobby', label: 'Hobbyist', d: 'M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z' },
    { id: 'other', label: 'Other', d: 'M5 12h.01M12 12h.01M19 12h.01' },
  ];

  // A list of models with an on/off switch each. opts: { models, enabled:[ids], onChange(ids) }
  function modelList(opts) {
    const on = new Set(opts.enabled);
    let all = false, query = '';
    const list = h('div', { class: 'mlist' });
    const more = h('button', { class: 'link', type: 'button', onclick: () => { all = !all; draw(); } });
    const search = h('input', { class: 'search', type: 'text', placeholder: 'Add or search model', oninput: e => { query = e.target.value.trim().toLowerCase(); draw(); } });
    const row = m => {
      const sw = h('button', { class: 'switch' + (on.has(m.id) ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(on.has(m.id)), 'aria-label': m.label });
      const r = h('div', { class: 'mrow', title: m.desc, onclick: () => { on.has(m.id) ? on.delete(m.id) : on.add(m.id); opts.onChange([...on]); draw(); } }, h('span', { class: 'mn', text: m.label }), sw);
      return r;
    };
    function draw() {
      const show = query || all ? opts.models : opts.models.filter(m => m.popular || on.has(m.id));
      const shown = show.filter(m => !query || (m.label + ' ' + m.id).toLowerCase().includes(query)).slice(0, 300);
      list.replaceChildren(...(shown.length ? shown.map(row) : [h('div', { class: 'none', text: opts.models.length ? 'No model matches.' : 'The model list could not be loaded. Check your internet connection.' })]));
      more.textContent = all ? 'Show fewer models' : 'View All Models';
      more.hidden = !!query;
    }
    draw();
    return h('div', { class: 'mbox' }, search, list, more);
  }

  window.CaretUI = { h, svg, ROLES, modelList };
})();
