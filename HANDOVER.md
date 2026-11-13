# Handover: Caret IDE, Caret website, Carnet website

Written 2026-11-14 for a new chat. Read all of it before touching anything. The owner writes Thai, wants short Thai answers, and has been
annoyed when files were sent before being verified. **Check the real app (screenshot of its own window) before saying something is done.**

## 0. The owner and the rules that apply

- Owner: Thai developer, GitHub `plawanpawin-byte`. Likes: pure dark, simple, "expensive" look, rounded corners, white pill buttons. Dislikes: VS Code look,
  square OS menus, sending half-finished files. Never copy Cursor's proprietary code or exact layout (learning concepts only; the user said
  "ห้ามก็อป layout ตั้งเอง").
- Commit identity: `git -c user.name=plawanpawin-byte -c user.email=plawanpawin@users.noreply.github.com commit ...` and end messages with
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git add .` in the Agent repo (it has stray untracked scripts); in Caret-IDE `git add -A` is fine.
- The permission classifier blocks (do not fight it, tell the user to run it): creating a PUBLIC repo; `wrangler secret put` (use `D:\Caret-Web\scripts\link-sites.js`
  which the user runs); reading `.dev.vars`; `git push --delete`; turning workspace trust off; killing apps by image name; capturing the whole screen.
  Kill only PIDs you started (`taskkill /PID <pid>` or `Stop-Process -Id <owner of port>`).
- Secrets never go into code or chat. Users' tokens are theirs.
- The Caret Agent (Electron app, `D:\Caret-Agent`) has a standing rule (memory `feedback_release-every-fix.md`): after every change bump version, `node scripts/check.js`,
  commit, push `ui/pro-layout` and `ui/pro-layout:main`, robocopy to `C:\cb`, build NSIS, `gh release create vX --target main` with `Caret.Agent.Setup.X.exe`, send the exe.
  The Agent is currently parked (see section 9); the IDE is the active product and has no such rule yet.

## 1. Projects, places, URLs

| What | Where | Remote / URL |
|---|---|---|
| **Caret IDE** (VS Code OSS based) | `D:\Caret-IDE` | private repo `plawanpawin-byte/Caret-IDE`, branch `main`, release `v0.1.0` |
| **Caret website** (dashboard, API keys, IDE sign-in) | `D:\Caret-Web` (NOT a git repo yet) | https://caret-agent.scratch-2026-11-04-b765df.workers.dev (Cloudflare Worker `caret-agent`, D1 `caret-agent` id `c574549d-a40c-4324-bc84-666787a6c66a`) |
| **Carnet website** (older site; holds the GitHub OAuth app) | `D:\carnet-web` | private repo `plawanpawin-byte/carnet-web`, https://carnet.scratch-2026-11-04-b765df.workers.dev (Worker `carnet`, KV) |
| **Caret Agent** (Electron 33 desktop agent, parked) | `D:\Caret-Agent` | branch `ui/pro-layout` (also `main`), releases up to v0.6.0, backups: tags `backup-agent-v0.5.0`, `backup-ide-ui-v0.3.5`, branches `backup/agent`, `backup/ide-ui` |

The IDE repo is private because creating a public one was blocked. The remote branch `master` still exists (delete was blocked); `main` is the default.

## 2. Caret IDE: what it is and how it is built

Base: **VSCodium 1.143.17232 (MIT)** unpacked in `D:\Caret-IDE\app` (gitignored, with `dl/`, `dist/`, `node_modules/`). VSCodium = VS Code OSS built without Microsoft's
branding/telemetry; its extension marketplace is Open VSX. We do not fork the source; `build.js` copies the release and patches files in the copy.

`node build.js` (107 lines) does, in order, into `dist/Caret-IDE/`:
1. copy `app/` -> `dist/Caret-IDE`, rename `VSCodium.exe` -> `Caret IDE.exe`.
2. `delete p.checksums` in `resources/app/product.json` (otherwise VS Code shows "installation appears to be corrupt" because we edit workbench files); set
   nameShort/nameLong `Caret IDE`, applicationName `caret-ide`, dataFolderName `.caret-ide`, empty updateUrl etc. NOTE: product.json `configurationDefaults` is ignored, defaults come from an extension.
3. copy every folder in `extensions/` (`caret-theme`, `caret-ai`) into `resources/app/extensions/` (they become built-in extensions).
4. **window icon**: overwrite `out/media/code-icon.svg` and `out/vs/workbench/browser/media/code-icon.svg` with an SVG that embeds `brand/icon.png` (the pen). Overwrite the
   editor watermark `letterpress-{dark,light,hcDark,hcLight}.svg` (in `out/media` and `out/vs/workbench/browser/parts/editor/media`) with the pen at 28% opacity.
5. **look**: append `brand/overrides.css` to `out/vs/workbench/workbench.desktop.main.css` (centers the top tab row, hides the "..." in the right panel header).
6. `rcedit` sets exe icon (`brand/icon.ico`) and version strings (rcedit path: `C:/Users/PC/AppData/Local/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe`).

Installer: `installer/caret-ide.nsi`, compile with
`C:\Users\PC\AppData\Local\electron-builder\Cache\nsis\nsis-3.0.4.1\Bin\makensis.exe -V1 installer\caret-ide.nsi` -> `dist\Caret-IDE-Setup-0.1.0.exe` (per-user install to
`%LOCALAPPDATA%\Programs\Caret IDE`, shortcuts, uninstaller). **It takes ~2-3 minutes (solid LZMA, ~160 MB). Run it in the background and send the file only after `makensis.exe` has exited**
(the file grows while it writes; the user once received 40 MB and 112 MB partial files). Zip alternative: `7z a -tzip` from `C:\Program Files\7-Zip\7z.exe` on `dist\Caret-IDE`.

Features that come from VS Code itself (turned on through `extensions/caret-theme/package.json` -> `contributes.configurationDefaults`): `workbench.activityBar.location: "top"`
(horizontal tab row inside the side bar), `workbench.experimental.modernUI: true` and `workbench.experimental.floatingPanels: true` (rounded floating panels; these ship in 1.143),
`window.menuBarVisibility: compact`, theme `Carnet Dark`, `chat.disableAIFeatures: true` (hides built-in AI), autosave, minimap off, telemetry off.
The warning "Cannot register configuration defaults for telemetry.telemetryLevel / window.menuBarVisibility" in the log is harmless.

### Files

- `extensions/caret-theme/package.json` and `themes/caret-dark-color-theme.json`: theme label **Carnet Dark** (file name still `caret-dark`). Palette now: editor `#0b0b0b`,
  panels `#111111`, cards `#181818`, borders `#2a2a2a`; text `#b8b5af`/`#ecebe8`; accent blue `#2b8fe0`; buttons are white (`button.background #e9e7e2`, foreground `#0b0b0b`).
  The user asked for "darker than the grey version but not as dark as the first (#040200)". Webview CSS (`chat.css`, `welcome.css`) uses the same greys; keep them in sync.
- `extensions/caret-ai/package.json`: view container `caret` in **`secondarySidebar`** (right side), webview view `caret.chat`; commands `caret.openChat`, `caret.newChat` (icon add),
  `caret.history` (icon history), `caret.welcome`, `caret.signIn`, `caret.signOut`; `menus.view/title` puts New chat and History as the header icons; keybindings Ctrl+L / Ctrl+Shift+L;
  `capabilities.untrustedWorkspaces: "limited"` (without it the extension is DISABLED in Restricted Mode and the right panel stays empty; this was a real bug the user hit).
- `extensions/caret-ai/extension.js` (240 lines): class `Chat`.
  - `MODELS` table: Sonnet 5.5 (`claude-sonnet-5-5`), Haiku 5.5, Opus 5.5, Fable 5.2 (`claude-fable-5-2`) via `claude`; **Astra 6, Luna 6, Sol 6** via `codex` with model names `astra-6`/`luna-6`/`sol-6`
    (the user never said what they are; this mapping is a guess, ask).
  - `MODES`: `plan` (system note makes the model print a numbered task list, no changes; runner permission `plan`), `code` (acceptEdits), `agent` (same + note to split into sub-agents).
    `full` flag (Full access toggle) -> runner mode `auto` (bypassPermissions for Claude, `--dangerously-bypass-approvals-and-sandbox` for Codex); ignored when `!vscode.workspace.isTrusted`.
  - `send(m)`: validates, saves pasted images (`data:image/(png|jpeg|webp|gif);base64`, max 6) to `%TEMP%\caret-images\`, adds "Attached image files (open them with the Read tool)" to the prompt, passes
    `--add-dir` (Claude) or `-i` (Codex). Records the chat (`this.cur.msgs`: user/ai/tool entries) and saves it to `workspaceState['caret.chats']` (max 40 chats). Posts `{type:'done', plan:true}` after a plan run.
  - `history()` shows a QuickPick of saved chats; choosing one posts `{type:'load', msgs}`. `newChat()`, `titleNow()` sets `view.title` to the first 40 chars of the first message (header shows "Caret AI: <title>").
  - Login: `login()` -> `lib/auth.js`; token in `context.secrets['caret.token']`, login name in `globalState['caret.login']`. `init()` re-checks the token with the site (`401` clears it).
  - Startup flow (end of `activate`): `chat.onAccount` handles login/logout (logged out: show the login page and close side bars; logged in: show Explorer and focus chat).
    After `chat.init()`: if not logged in or no folder open -> `welcome.show`; always `closeStock` after 2.5 s (closes VS Code's own "Welcome" tab); if logged out close side bars, else focus chat.
- `lib/welcome.js` + `media/welcome.js/.css`: one webview panel "Welcome". Not logged in: big pen, "Caret IDE", "The free IDE. No subscription.", white pill "Continue with GitHub".
  Logged in: "Hey <login>", 3 tiles (Open project [white], Clone repo, New file) and Recent projects (via the internal command `_workbench.getRecentlyOpened`). `closeStock()` closes the stock Welcome tab.
- `lib/auth.js`: loopback PKCE sign-in. `SITE = https://caret-agent.scratch-2026-11-04-b765df.workers.dev`. Opens `SITE/auth/app?port&state&challenge`, listens on `127.0.0.1:<random port>/cb`
  (checks Host header for DNS rebinding and the `state`), exchanges `code`+`verifier` at `POST /api/app/exchange`, stores the app token. `check(token)` = `GET /api/app/me`, `logout` = `POST /api/app/logout`.
- `lib/runners.js`: `runClaude` spawns `claude -p --output-format stream-json --verbose [--model] [--resume sessionId] [--add-dir] [--append-system-prompt] --permission-mode plan|acceptEdits|bypassPermissions`,
  prompt on stdin, parses events (`assistant` text/tool_use, `user` tool_result, `result`), kills the process tree 1.5 s after `result` (a dev server left running would hold the pipe).
  `runCodex` spawns `codex exec --json --skip-git-repo-check -C <dir> -m <model> --sandbox read-only|workspace-write | --dangerously-bypass... [-i image] -`.
- `lib/cli.js`: finds `claude`/`codex` (`which`, extra dirs such as `%APPDATA%\npm`), `fixPath()`.
- `media/chat.js` (210 lines) + `chat.css`: the chat webview. Everything is built with `h()` + `textContent` (CSP: `script-src 'nonce-...'`, `style-src ${cspSource}`: **inline style attributes would be blocked**, use `el.style.x`).
  Pieces: tiny safe markdown (paragraphs, code fences, `inline`, bold, and lists shown as checkbox task cards), custom round dropdown `dropdown()` (class `.ddw/.dd/.pop/.opt`) for mode (Plan/Code/Agent with descriptions)
  and model, **Full access** toggle (`.fullbtn`, orange when on, label hidden below 300 px via a container query), attach icon `ctxBtn` (include open file and selection), round send button (grey when empty, white otherwise, square while running),
  image paste (Ctrl+V -> thumbnails, x to remove, sent images show in the bubble with a **Reuse** button), plan card ("Plan ready. Switch to a coding mode?" -> Code / Agent / Keep planning; with Full access it switches and sends "Go ahead and build the plan above." by itself),
  `load` message for history. The textarea grows to 120 px then scrolls (`overflow-wrap:anywhere`), composer `flex:none`, feed `min-height:0`, row `flex-wrap:nowrap`.
- `brand/`: `pen.png` (the logo the owner supplied, 1254x1254, black background), `icon.png` (white pen with luminance alpha, 512), `icon.ico`, `overrides.css`.
- `tools/`: see section 6.

## 3. Caret website (`D:\Caret-Web`, Cloudflare Worker + D1)

`src/index.js` (352 lines), `public/*`, `migrations/0001_init.sql` (users, sessions, api_keys, usage), `0002_app.sql` (app_codes, app_tokens), `wrangler.jsonc`
(assets `run_worker_first: true`, D1 binding `DB`, rate limit binding `LIMITER` namespace `2001` 30/min, var `CARNET_URL`).

- Sign-in is **delegated to Carnet** so that no new GitHub OAuth app is needed: `/auth/github` sets a flow cookie `{s: state, app?}` and redirects to `CARNET_URL/auth/delegate?state=`;
  Carnet (which holds the GitHub OAuth app) signs in the user and redirects to `.../auth/delegate/callback?a=<b64url JSON>.<HMAC-SHA256>` (payload `{id, login, avatar, state, exp: +60 s}`); the Caret site verifies
  the HMAC with the shared secret `DELEGATE_SECRET` (set on BOTH workers by `node scripts/link-sites.js`, run by the user), checks state and expiry, upserts the user, creates a session cookie `__Host-caret_session`.
  If the flow came from the IDE the redirect goes to `http://127.0.0.1:<port>/cb?code=...&state=...` instead of `/dashboard`.
- IDE endpoints: `GET /auth/app?port&state&challenge` (-> `/login?app=1&...`), `GET /auth/app/go` ("Continue as", needs a session), `POST /api/app/exchange` (one-use code, PKCE S256, 2 min), `GET /api/app/me`, `POST /api/app/logout`. App tokens last 90 days, stored hashed.
- Dashboard API (cookie session + same-origin check): `/api/me`, `/api/keys` (GET/POST, `DELETE /api/keys/:id`, keys `caret_<43 chars>`, only the hash is stored, shown once), `/api/usage`, `/api/billing` (plan Free, `MONTH_LIMIT = 1000` is display only), `/api/sessions` (+`DELETE /api/sessions/[wa]<12 hex>`), `DELETE /api/account`.
  Public: `GET /v1/whoami` with `Authorization: Bearer caret_...` (counts usage). It does NOT call any model yet. The next real product step is a `/v1/chat/completions` proxy plus the IDE using the key (the owner has not decided).
- Pages: `index.html` (landing; uses `img/ide.png` from an older UI), `login.html/js`, `dashboard.html/js` (only **Overview** and **Settings**, no Back button, grey card style the owner asked for; Settings has Account, API keys, Active sessions, Danger zone), `site.css`.
  CSP forbids inline styles: `dashboard.js` `h()` sets `style` through `el.style.cssText`.
- `/auth/dev` (test login without GitHub) only works when `DEV_LOGIN=1` in `.dev.vars` AND the host is localhost.
- Deploy: `cd D:\Caret-Web; env -u CLOUDFLARE_API_TOKEN node node_modules/wrangler/bin/wrangler.js deploy` (PowerShell: `$env:CLOUDFLARE_API_TOKEN=$null` first). Local: `wrangler d1 migrations apply caret-agent --local`, then `wrangler dev --port 8790 --local`.
  Migrations to production: `... d1 migrations apply caret-agent --remote`.

## 4. Carnet website (`D:\carnet-web`)

`src/worker.js` (~430 lines), `src/crypto.js`, `public/` (landing, `_signin/index.html` shell, `_app/index.html` shell, docs), KV `CARNET`, rate limit `LIMITER` 30/min, 33 tests (`npm test`, must stay green).
It serves the Caret **Agent** (OpenRouter connect, `/auth/app`, `/api/app/*`) and now also `GET /auth/delegate?state=` + `delegateRedirect()` for the Caret site (vars `DELEGATE_URL`, secret `DELEGATE_SECRET`).
Secrets on the worker: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ENCRYPTION_KEY`, `DELEGATE_SECRET`. The sign-in page got the black pen design (`pen.png`, `pen-64.png`). Deploy command is the same as above.

## 5. How things were verified (use these again)

Rule: **screenshot of the app's own window, read the image, then decide.** Never the whole screen (a private game once got captured).

1. `tools/shot.ps1` (PowerShell, PrintWindow on the window handle): `powershell -File tools\shot.ps1 -Folder D:\x -Out %TEMP%\a.png -Wait 20 [-Fresh]`. Wait >= 16 s (the chat webview renders late; 20-40 s for network checks).
   Uses its own profile `%TEMP%\caret-shot-profile` so the user's data is untouched. To test the user's real state, copy `%APPDATA%\Caret IDE\User` into a scratch profile first.
   Do NOT pass `--disable-workspace-trust` if you want to see what the user sees (Restricted Mode is what hid the chat).
2. Fake login for screenshots: the real token is checked against the site and cleared if rejected. Temporarily patch **`dist/Caret-IDE/resources/app/extensions/caret-ai/extension.js`** (not the source), e.g. add
   `setTimeout(() => { chat.account = { login: 'demo' }; chat.push(); chat.onAccount(); }, 11000);` before the "test hook" comment, run shot.ps1, then **run `node build.js` again to remove the patch** and `grep` that it is gone.
   For a real message test, drop an `e2e.js` into the dist extension folder that calls `chat.send({text, model:'sonnet-5-5', mode:'code', full:true})` with `chat.root = <temp dir>` and writes a log file (this proved coding works end to end:
   Write tool -> `hello.py` created -> text "done" -> `done` event). Keep it out of the shipped build.
3. `tools/runtest.js <model> <mode> "<prompt>"` runs `lib/runners.js` against the real `claude` CLI in a temp folder (all four Claude model ids were tested this way).
4. `tools/cdp.js "<js expression>"` launches the IDE with `--remote-debugging-port=9333` and evaluates JS in the workbench page (used to read DOM class names, e.g. the tab row is `.part.sidebar .composite.header .composite-bar-container`).
5. Chat UI harness `tools/harness/` (static page + mocked `acquireVsCodeApi`) in the Claude **built-in browser pane**: `python -m http.server 8791`, navigate (the first navigation to a new port often fails, retry), `resize_window 360x760`, post messages, screenshot.
   Reset the viewport with `resize_window preset desktop` afterwards. Stop servers by the PID that owns the port.
6. Website: `wrangler dev --local` + `/auth/dev`; curl the live endpoints after deploy (expect `/auth/github` 302, `/dashboard` 302 to `/login` when signed out, forged callback -> `/login?error=state`).

## 6. Environment gotchas

- Shell is Git Bash (and PowerShell). **Heredocs containing apostrophes or `\` often break** ("unexpected EOF"). Write scripts with the Write tool (python/node file) and run them. The Edit tool needs a prior Read of the file in this session.
- Windows paths: use `/d/...` in bash, `D:\...` in PowerShell and in JSON/JS strings escape backslashes.
- Tool output for long builds: run in background (`run_in_background`) and wait on the process, do not poll with sleep.
- Browser pane screenshots sometimes time out: retry. The pane is small by default (about 713x286) so resize it before judging layouts.
- Cloudflare auth: wrangler works only when `CLOUDFLARE_API_TOKEN` is unset (`env -u`), it uses the user's login.
- The user's installed IDE state lives in `%APPDATA%\Caret IDE\User\globalStorage\state.vscdb` (SQLite) and extensions in `%USERPROFILE%\.caret-ide`. An old profile kept a stale built-in "Chat" placeholder panel in the right bar
  (`workbench.auxiliarybar.placeholderPanels`); the fix given to the user is to delete `state.vscdb*` while the app is closed (they must log in again). The user's run folder was `C:\Users\PC\Downloads\Caret-IDE` (an unzip).

## 7. State at the end of this chat

Done and verified (by screenshot or real run): pen logo everywhere, Welcome/login screens, floating rounded panels, centered top tab row, chat on the right with New chat + History icons, model/mode round menus, one-row prompt bar,
Plan/Code/Agent, Full access toggle, image paste (thumbnails and sending to the extension host verified; the model actually reading the image NOT verified), real Claude run through the extension host, chat renders in Restricted Mode,
Caret website deployed with delegated GitHub sign-in (the user logged in successfully and the chat showed "Hey plawanpawin-byte"), dashboard Overview/Settings.

Latest commits are in `main` of Caret-IDE. **GitHub release v0.1.0 still holds an OLD zip** (login via the new site but old UI). The newest installer `dist\Caret-IDE-Setup-0.1.0.exe` (160 MB) was sent to the user in chat but never uploaded
(upload was interrupted by the user twice; do it only if asked: `gh release upload v0.1.0 dist/Caret-IDE-Setup-0.1.0.exe --clobber --repo plawanpawin-byte/Caret-IDE`).
Remember to bump the version (`package.json`, `build.js` VERSION, `installer/caret-ide.nsi`) before a new release.

Known gaps and ideas:
- Astra 6 / Luna 6 / Sol 6 mapping is unconfirmed; Codex path (`runCodex`, images `-i`) is untested end to end.
- Plan -> Code auto switch (Full access) only tested with a mocked page; plan text rendering depends on the model writing a numbered list (Claude's own plan mode tends to write a plan file, so the system note says not to).
- The chat has no streaming token display beyond whole text blocks, no diff view, no stop-all; chat history stores text, tool names and results only (images are shown as "[n picture]").
- Menu and layout polish the owner may ask next: more Cursor-like header title ("Caret AI: New Chat" prefix comes from VS Code), a log-out entry somewhere other than the chat header (only the command `Caret: Log Out` exists; the user said it must not sit in the chat),
  stock VS Code Welcome/Get Started text "Editing evolved" still reachable from Help.
- No code signing, no auto-update; Windows SmartScreen warns.
- `D:\Caret-Web` should become a (private) git repo; the landing screenshot `public/img/ide.png` is outdated; `/v1` has no model proxy; Billing is display only.
- Connectors/MCP marketplace was deliberately removed from the IDE ("use VS Code extensions / Open VSX instead"). The Agent app still has it.

## 8. Quick commands

```
cd D:\Caret-IDE
node build.js                                   # rebuild dist\Caret-IDE (about 30 s)
powershell -File tools\shot.ps1 -Out %TEMP%\a.png -Wait 25
installer: makensis (section 2), then check size ~160 MB and that makensis.exe has exited
git add -A; git -c user.name=plawanpawin-byte -c user.email=plawanpawin@users.noreply.github.com commit -m "..."; git push origin main
cd D:\Caret-Web; env -u CLOUDFLARE_API_TOKEN node node_modules/wrangler/bin/wrangler.js deploy
```

## 9. Caret Agent (parked) in one paragraph

Electron 33 app in `D:\Caret-Agent` (`src/main`, `src/preload`, `src/renderer`, `scripts/check.js`, `scripts/selftest.js` with 43 checks, `scripts/fuses.js` flips Electron fuses in `afterPack`). It signs in through Carnet, has a Connectors marketplace
(`src/main/extensions.js`), dark "desktop agent" layout (`theme.css`), and releases to `plawanpawin-byte/Caret-Agent`. The owner paused it ("สำรอง agent ไว้ ไปทำ ide") and moved to the VS Code OSS based IDE because the custom Monaco IDE was not usable like Cursor.
