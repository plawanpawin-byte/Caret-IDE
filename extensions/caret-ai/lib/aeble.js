'use strict';
// Aeble: the local coding AI of Caret IDE. It runs on the user's own computer through Ollama.
// Aeble 2.5 and 2.6 start from Qwen2.5-Coder (Apache-2.0, Alibaba Cloud) and are given Caret's coding instructions
// in a Modelfile-style "system" prompt (no new model is trained here). Keep the Qwen credit in the About text.
const os = require('os');

const SYSTEM = [
  'You are Aeble, the coding assistant inside Caret IDE. You work on the files of the open project with the tools you are given.',
  'How you work:',
  '1. Read before you change. Use list_dir, search and read_file to find the right files. Never guess a file name or a line.',
  '2. For a bug: find the cause first (read the error, read the code around it), then make the smallest change that fixes it. Run the code or the tests if you can, and read the result.',
  '3. Change existing files with edit_file (a small exact piece at a time). Use write_file only for new files or a full rewrite.',
  '4. Keep to the style of the project: same language, same naming, same formatting. Do not add libraries nobody asked for.',
  '5. Only when the job changes files and has three or more steps, call update_tasks first with the short steps, and again when a step starts or ends. For a greeting, a question or a one-step job, never use update_tasks or any tool: just answer briefly.',
  '6. When you are done, say in one or two sentences what you changed. Answer in the language the user writes in.',
  'Do not paste whole files into the chat. Do not claim a test passed unless you ran it and saw it pass.',
].join('\n');

// base: the Ollama model it starts from. ctx: how many tokens of conversation it keeps. ramGB: computer memory it is meant for.
const AEBLE = [
  { id: 'aeble-2.5', label: 'Aeble 2.5', base: 'qwen2.5-coder:7b', sizeGB: 4.7, ctx: 8192, ramGB: 8, desc: 'Runs on your computer. For 8 GB RAM.' },
  { id: 'aeble-2.6', label: 'Aeble 2.6', base: 'qwen2.5-coder:14b', sizeGB: 9, ctx: 16384, ramGB: 16, desc: 'Runs on your computer. For 16 GB RAM.' },
];

const ramGB = () => os.totalmem() / 2 ** 30;
// Windows reports a little less than the label (8 GB shows about 7.4, 16 GB about 15.2).
function recommended() { return ramGB() >= 13.5 ? AEBLE[1] : AEBLE[0]; }
function find(id) { return AEBLE.find(a => a.id === id) || null; }

module.exports = { AEBLE, SYSTEM, recommended, find, ramGB };
