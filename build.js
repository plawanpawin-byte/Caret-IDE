'use strict';
// Builds CaretStudio from the VSCodium release in app/ (VS Code OSS, MIT): new name and icon, product settings,
// our built-in extensions (theme, AI). Output: dist/CaretStudio (a portable folder; run "CaretStudio.exe").
//   node build.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'app');
const OUT = path.join(ROOT, 'dist', 'CaretStudio');
const EXE = 'CaretStudio.exe';
const RCEDIT = 'C:/Users/PC/AppData/Local/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe';
const ICON = path.join(ROOT, 'brand', 'icon.ico');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const step = m => console.log('•', m);

step('copying the base');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.cpSync(SRC, OUT, { recursive: true });

step('renaming');
fs.renameSync(path.join(OUT, 'VSCodium.exe'), path.join(OUT, EXE));
fs.renameSync(path.join(OUT, 'VSCodium.VisualElementsManifest.xml'), path.join(OUT, 'CaretStudio.VisualElementsManifest.xml'));
const manifest = path.join(OUT, 'CaretStudio.VisualElementsManifest.xml');
fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('ShortDisplayName="VSCodium"', 'ShortDisplayName="CaretStudio"').replace('#2D2D30', '#0E0C0A'));
for (const f of ['codium', 'codium.cmd']) {
  const p = path.join(OUT, 'bin', f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split('VSCodium.exe').join(EXE));
  fs.renameSync(p, path.join(OUT, 'bin', f.replace('codium', 'caret-studio')));
}
fs.renameSync(path.join(OUT, 'bin', 'codium-tunnel.exe'), path.join(OUT, 'bin', 'caret-studio-tunnel.exe'));

step('product.json');
const pj = path.join(OUT, 'resources', 'app', 'product.json');
const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
delete p.checksums; // we change workbench files on purpose, so the stock checksum check would cry "corrupt"
Object.assign(p, {
  caretVersion: VERSION, nameShort: 'CaretStudio', nameLong: 'CaretStudio', applicationName: 'caret-studio',
  dataFolderName: '.caret-studio', sharedDataFolderName: '.caret-studio-shared',
  win32MutexName: 'caretstudio', win32DirName: 'CaretStudio', win32NameVersion: 'CaretStudio', win32RegValueName: 'CaretStudio',
  win32AppUserModelId: 'Caret.CaretStudio', win32ShellNameShort: 'CaretStudio', win32TunnelServiceMutex: 'caretstudio-tunnelservice', win32TunnelMutex: 'caretstudio-tunnel',
  urlProtocol: 'caret-studio', linuxIconName: 'caret-studio', darwinBundleIdentifier: 'app.caretagent.studio',
  tunnelApplicationName: 'caret-studio-tunnel',   // the server names stay VSCodium's (codium-server): SSH downloads VSCodium's server build
  reportIssueUrl: 'https://github.com/plawanpawin-byte/Caret-IDE/issues/new', downloadUrl: 'https://github.com/plawanpawin-byte/Caret-IDE/releases',
  licenseUrl: 'https://github.com/plawanpawin-byte/Caret-IDE',
  updateUrl: '', // VS Code's own updater is off; CaretStudio's updater (extensions/caret-ai/lib/update.js) reads GitHub releases
  configurationDefaults: {
    ...(p.configurationDefaults || {}),
    'workbench.colorTheme': 'Carnet Dark',
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'workbench.startupEditor': 'none',
    'editor.minimap.enabled': false,
    'editor.fontFamily': "'Cascadia Code', Consolas, 'Courier New', monospace",
    'editor.fontSize': 14,
    'editor.smoothScrolling': true,
    'editor.cursorSmoothCaretAnimation': 'on',
    'window.commandCenter': true,
    'workbench.layoutControl.enabled': false,
    'files.autoSave': 'afterDelay',
    'git.autofetch': true,
    'git.confirmSync': false,
  },
});
fs.writeFileSync(pj, JSON.stringify(p, null, '\t'));

step('built-in extensions');
const extDir = path.join(OUT, 'resources', 'app', 'extensions');
for (const name of fs.readdirSync(path.join(ROOT, 'extensions'))) {
  const from = path.join(ROOT, 'extensions', name);
  if (fs.statSync(from).isDirectory()) fs.cpSync(from, path.join(extDir, name), { recursive: true });
}

step('window icon');
{
  const b64 = fs.readFileSync(path.join(ROOT, 'brand', 'icon.png')).toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/png;base64,${b64}"/></svg>`;
  for (const f of ['out/media/code-icon.svg', 'out/vs/workbench/browser/media/code-icon.svg']) {
    const t = path.join(OUT, 'resources', 'app', f);
    if (fs.existsSync(t)) fs.writeFileSync(t, svg);
  }
  const dim = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><image opacity="0.28" width="256" height="256" href="data:image/png;base64,${b64}"/></svg>`;
  for (const f of ['out/media', 'out/vs/workbench/browser/parts/editor/media']) {
    const d = path.join(OUT, 'resources', 'app', f);
    if (!fs.existsSync(d)) continue;
    for (const n of fs.readdirSync(d)) if (/^letterpress-(dark|light|hcDark|hcLight)\.svg$/.test(n)) fs.writeFileSync(path.join(d, n), dim);
  }
}

step('look');
{
  const css = path.join(OUT, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
  fs.appendFileSync(css, '\n' + fs.readFileSync(path.join(ROOT, 'brand', 'overrides.css'), 'utf8'));
}

step('Settings opens Caret settings');
{
  // The gear menu and Ctrl+, run the stock openSettings action with no arguments: send that to our Settings page.
  // Calls that carry a query (links that jump to one setting) keep opening the stock screen.
  const f = path.join(OUT, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
  const code = fs.readFileSync(f, 'utf8');
  const from = 'run(t,i){let n=typeof i=="string"?{query:i}:aq(i);return t.get(Mn).openSettings({...n})}';
  const to = 'run(t,i){if(i===void 0)return t.get(ye).executeCommand("caret.openSettings","profile");let n=typeof i=="string"?{query:i}:aq(i);return t.get(Mn).openSettings({...n})}';
  if (!code.includes(from)) throw new Error('Settings patch: the stock code was not found (the base app changed). Update build.js.');
  fs.writeFileSync(f, code.replace(from, () => to));
}

step('Gear opens Settings directly');
{
  // One click on the gear opens our Settings page (the stock gear shows a menu first). Right-click still works as before.
  const f = path.join(OUT, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
  const code = fs.readFileSync(f, 'utf8');
  const from = 'i=await this.resolveMainMenuActions(t,e),{anchorAlignment:n,anchorAxisAlignment:r}=this.contextMenuAlignmentOptions()??{anchorAlignment:void 0,anchorAxisAlignment:void 0};this.contextMenuService.showContextMenu({getAnchor:()=>this.label,';
  const to = 'i=await this.resolveMainMenuActions(t,e),caretS=this.menuId===F.GlobalActivity?i.find(x=>x.id==="workbench.action.openSettings"):null,{anchorAlignment:n,anchorAxisAlignment:r}=this.contextMenuAlignmentOptions()??{anchorAlignment:void 0,anchorAxisAlignment:void 0};if(caretS){e.dispose();await caretS.run();return}this.contextMenuService.showContextMenu({getAnchor:()=>this.label,';
  if (code.split(from).length !== 2) throw new Error('Gear patch: the stock code was not found exactly once (the base app changed). Update build.js.');
  fs.writeFileSync(f, code.replace(from, () => to));
}

step('icon and version');
if (fs.existsSync(RCEDIT) && fs.existsSync(ICON)) {
  const r = spawnSync(RCEDIT, [path.join(OUT, EXE), '--set-icon', ICON,
    '--set-version-string', 'FileDescription', 'CaretStudio', '--set-version-string', 'ProductName', 'CaretStudio',
    '--set-version-string', 'InternalName', 'CaretStudio', '--set-version-string', 'OriginalFilename', EXE,
    '--set-version-string', 'CompanyName', 'Caret', '--set-file-version', VERSION, '--set-product-version', VERSION], { encoding: 'utf8' });
  if (r.status !== 0) console.log('icon step failed:', r.stderr || r.error);
} else console.log('no rcedit or icon: skipped');
console.log('done:', OUT);
