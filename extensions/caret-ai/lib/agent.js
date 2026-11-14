'use strict';
// The agent loop for the local AI: ask the model, run the tools it calls, give it the results, repeat.
const openrouter = require('./openrouter');
const tools = require('./tools');

const SYSTEM = [
  'You are Caret, a coding assistant inside the Caret IDE. You work in the open project folder with tools.',
  'Read the relevant files before you change them. Find the cause of a problem before you fix it. Make small, exact edits with edit_file and keep the existing style of the project.',
  'For work with several steps, call update_tasks first to show the plan, then again as steps finish.',
  'When files changed, check your work (run the program or tests if you may, otherwise re-read the files). Answer in the language the user writes in, briefly.',
].join(String.fromCharCode(10));

const MAX_STEPS = { plan: 14, code: 30, agent: 40 };

// A long run piles up file contents and command output. Shrink the oldest tool results first so the instructions
// and the latest steps are never the part that gets cut off.
function compact(messages, budget) {
  const size = () => messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
  if (size() <= budget) return;
  const idx = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter(i => i >= 0);
  for (const i of idx.slice(0, -4)) {
    if (messages[i].content.length > 300) messages[i] = { ...messages[i], content: messages[i].content.slice(0, 200) + '\n[older output shortened to save space]' };
    if (size() <= budget) return;
  }
}

// opts: { model, mode, prompt, system, history:[{role,content}], cwd, full, numCtx, think, on }
function runLocal(opts) {
  const abort = new AbortController();
  const result = { error: null, answer: '', files: [] };
  const on = opts.on;
  const numCtx = opts.numCtx || 32768;
  const budget = Math.floor(numCtx * 2.6);   // about 4 characters per token, with room left for the answer
  const mode = ['plan', 'code', 'agent'].includes(opts.mode) ? opts.mode : 'code';
  let ranCommand = false;
  const run = { root: opts.cwd, full: !!opts.full, signal: abort.signal, files: result.files, on };

  const done = (async () => {
    try {
      const messages = [{ role: 'system', content: SYSTEM + (opts.system ? '\n\n' + opts.system : '') }, ...(opts.history || []).slice(-10), { role: 'user', content: opts.prompt }];
      const defs = tools.definitions(mode, !process.env.AEBLE_NO_TASKS);
      let nudged = false, badCalls = 0, verified = false;
      const seen = new Set();
      const writes = new Map();
      for (let step = 0; step < MAX_STEPS[mode]; step++) {
        if (abort.signal.aborted) return;
        compact(messages, budget);
        let turn;
        try {
          turn = await openrouter.chat({ key: opts.key, model: opts.model, messages, tools: defs, signal: abort.signal, onEvent: ev => { if (ev.type !== 'text') on.thinking && on.thinking(ev.text); } });
          if (turn.content.trim()) on.text(turn.content.trim());   // one message per turn: the chat puts every text event in its own paragraph
        } catch (e) {
          if (abort.signal.aborted) return;
          // A small model sometimes writes a tool call the server cannot read. Ask it to try again.
          if (badCalls < 4 && /syntax error|error parsing tool call|invalid character|unexpected end of JSON|unmarshal/i.test(e.message)) {
            badCalls++;
            messages.push({ role: 'user', content: 'Your last tool call was malformed and could not be read. Call the tool again with simple, valid arguments, and change one short piece at a time with edit_file.' });
            continue;
          }
          throw e;
        }
        if (process.env.AEBLE_DEBUG) console.error('[turn]', step, JSON.stringify(turn.content.slice(0, 160)), turn.calls.length);
        if (turn.content.trim()) result.answer = turn.content.trim();
        if (!turn.calls.length) {
          // A small model often says what it is about to do ("I will change...") and then ends its turn. Push once.
          const promised = /(i will|i[’']ll|i am going to|i[’']m going to|let me|next,? i|the necessary change|here is the fix|to fix (it|this)|we need to|should be changed|ผมจะ|จะแก้|ขอแก้)/i.test(turn.content);
          if ((!turn.content.trim() || promised) && !nudged && mode !== 'plan' && !result.files.length && (step > 0 || promised)) {
            nudged = true;
            if (turn.content.trim()) messages.push({ role: 'assistant', content: turn.content });
            messages.push({ role: 'user', content: 'Do not explain, do it: call the edit_file tool now with the exact old_text from the file and the new_text. After the tool result, say in one sentence what you changed.' });
            continue;
          }
          // It changed files and is about to say "done" without having checked: ask once for a check.
          if (!verified && mode !== 'plan' && result.files.length) {
            verified = true;
            messages.push({ role: 'user', content: run.full ? 'Before you finish, check your work: run the program or its tests with run_command and read the output, or read the changed files again. If something is wrong, fix it. Then reply with a short summary.' : 'Before you finish, read the changed files again and check nothing was lost by mistake (for example a function or export you meant to keep). If something is wrong, fix it. Then reply with a short summary.' });
            continue;
          }
          // A small model sometimes says it ran the program when it never did. Say so.
          if (!ranCommand && /(i (have )?(ran|run|tested|executed)|the output (was|is)|tests? (passed|pass))/i.test(turn.content)) on.text('\n\n_Note: nothing was actually run in this chat' + (run.full ? '.' : ' (running commands needs Full access).') + ' Please check the result yourself._');
          if (!turn.content.trim() && !result.answer && !result.files.length) on.text('_The model stopped without doing anything. Send the request again._');
          return;
        }
        messages.push({ role: 'assistant', content: turn.content, tool_calls: turn.calls });
        for (const call of turn.calls) {
          if (abort.signal.aborted) return;
          const name = call.function.name;
          const args = openrouter.parseArgs(call.function.arguments);
          let text;
          if (name === 'update_tasks') {
            // shown as the task card in the chat (same one Claude's TodoWrite uses)
            const todos = (Array.isArray(args.tasks) ? args.tasks : []).slice(0, 12).map(t => ({ content: String(t.content || '').slice(0, 120), status: ['pending', 'in_progress', 'completed'].includes(t.status) ? t.status : 'pending' }));
            on.tool({ id: 'local-tasks', name: 'TodoWrite', args: { todos }, status: 'done' });
            text = 'ok';
          } else {
            on.tool({ id: call.id, name, args, status: 'running' });
            if (!tools.allowedIn(mode, name)) { text = `Error: ${name} is not available in ${mode} mode.`; on.tool({ id: call.id, status: 'error', result: text }); }
            else {
              const readOnly = name === 'read_file' || name === 'list_dir' || name === 'search';
              const key = name + '|' + JSON.stringify(args) + '|' + result.files.length;
              const isWrite = name === 'write_file' || name === 'edit_file';
              const sig = name + '|' + JSON.stringify(args);
              const again = isWrite && writes.get('w:' + args.path) === sig;               // same change as the last one to this file
              const tooMany = isWrite && !again && (writes.get('n:' + args.path) || 0) >= 5; // going round in circles on one file
              if (again || tooMany) {
                text = tooMany ? `You have already changed ${args.path} ${writes.get('n:' + args.path)} times. Stop editing it. Read it once, check it is correct, then reply with a short summary.` : 'You already made exactly this change; the file is already in that state. Do not repeat it. Read the file to check it, then reply with a short summary.';
                on.tool({ id: call.id, status: 'done', result: text });
              } else
              if (readOnly && seen.has(key)) { text = 'You already did exactly this and nothing has changed since. Use what you have and make the change now.'; on.tool({ id: call.id, status: 'done', result: text }); }
              else {
                seen.add(key);
                try { if (name === 'run_command' && run.full) ranCommand = true; text = String(await tools.execute(name, args, run)); on.tool({ id: call.id, status: 'done', result: text }); if (isWrite) { writes.set('w:' + args.path, sig); writes.set('n:' + args.path, (writes.get('n:' + args.path) || 0) + 1); } }
                catch (e) { text = 'Error: ' + e.message; on.tool({ id: call.id, status: 'error', result: e.message }); }
              }
            }
          }
          messages.push({ role: 'tool', tool_call_id: call.id, name, content: text.slice(0, Math.min(20000, Math.floor(budget / 4))) });
        }
      }
      on.text(`\n\n_Reached the step limit for ${mode} mode. Say "continue" to keep going._`);
    } catch (e) { if (!abort.signal.aborted) result.error = String(e.message || e); }
  })().then(() => result);

  return { stop: () => abort.abort(), done };
}

module.exports = { runAgent: runLocal, compact };
