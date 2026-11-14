'use strict';
// Messages from the setup screens and the Settings page about the AI: role, API key, which models show in the chat menu.
const vscode = require('vscode');
const openrouter = require('./openrouter');

const ROLES = ['engineer', 'student', 'designer', 'data', 'founder', 'hobby', 'other'];
const LINKS = { keys: openrouter.KEYS_URL, credits: openrouter.CREDITS_URL };

async function ai(chat) {
  if (!chat.catalog) await chat.loadModels();
  return {
    type: 'ai', hasKey: !!chat.orKey, masked: chat.maskedKey(), role: chat.ctx.globalState.get('caret.role') || '',
    onboarded: !!chat.ctx.globalState.get('caret.onboarded'),
    models: (chat.catalog || []).map(m => ({ id: m.id, label: m.label, desc: m.desc, popular: m.popular })), enabled: chat.enabledIds(),
  };
}

// post(message) sends to the page that asked. Returns true when the message was one of ours.
async function handle(chat, m, post) {
  switch (m && m.type) {
    case 'aiState': post(await ai(chat)); return true;
    case 'saveRole': if (ROLES.includes(m.role)) await chat.ctx.globalState.update('caret.role', m.role); return true;
    case 'saveKey': { const r = await chat.setKey(m.key); post({ type: 'keyResult', ok: r.ok, error: r.error || null }); if (r.ok) post(await ai(chat)); return true; }
    case 'removeKey': await chat.removeKey(); post(await ai(chat)); return true;
    case 'setEnabled': if (Array.isArray(m.ids)) await chat.setEnabled(m.ids); return true;
    case 'finishSetup': await chat.ctx.globalState.update('caret.onboarded', true); post({ type: 'setupDone' }); return true;
    case 'link': if (LINKS[m.name]) vscode.env.openExternal(vscode.Uri.parse(LINKS[m.name])); return true;
    default: return false;
  }
}

module.exports = { handle, ai };
