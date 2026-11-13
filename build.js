'use strict';
// Builds Caret IDE from the VSCodium release in app/ (VS Code OSS, MIT): new name and icon, product settings,
// our built-in extensions (theme, AI). Output: dist/Caret-IDE (a portable folder; run "Caret IDE.exe").
//   node build.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'app');
const OUT = path.join(ROOT, 'dist', 'Caret-IDE');
const EXE = 'Caret IDE.exe';
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
fs.renameSync(path.join(OUT, 'VSCodium.VisualElementsManifest.xml'), path.join(OUT, 'Caret IDE.VisualElementsManifest.xml'));
const manifest = path.join(OUT, 'Caret IDE.VisualElementsManifest.xml');
fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace('ShortDisplayName="VSCodium"', 'ShortDisplayName="Caret IDE"').replace('#2D2D30', '#0E0C0A'));
for (const f of ['codium', 'codium.cmd']) {
  const p = path.join(OUT, 'bin', f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split('VSCodium.exe').join(EXE));
  fs.renameSync(p, path.join(OUT, 'bin', f.replace('codium', 'caret-ide')));
}
fs.renameSync(path.join(OUT, 'bin', 'codium-tunnel.exe'), path.join(OUT, 'bin', 'caret-ide-tunnel.exe'));

step('product.json');
const pj = path.join(OUT, 'resources', 'app', 'product.json');
const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
Object.assign(p, {
  nameShort: 'Caret IDE', nameLong: 'Caret IDE', applicationName: 'caret-ide',
  dataFolderName: '.caret-ide', sharedDataFolderName: '.caret-ide-shared',
  win32MutexName: 'caretide', win32DirName: 'Caret IDE', win32NameVersion: 'Caret IDE', win32RegValueName: 'CaretIDE',
  win32AppUserModelId: 'Caret.CaretIDE', win32ShellNameShort: 'Caret IDE', win32TunnelServiceMutex: 'caretide-tunnelservice', win32TunnelMutex: 'caretide-tunnel',
  urlProtocol: 'caret-ide', linuxIconName: 'caret-ide', darwinBundleIdentifier: 'app.caretagent.ide',
  serverApplicationName: 'caret-ide-server', serverDataFolderName: '.caret-ide-server', tunnelApplicationName: 'caret-ide-tunnel',
  reportIssueUrl: 'https://github.com/plawanpawin-byte/Caret-Agent/issues/new', downloadUrl: 'https://github.com/plawanpawin-byte/Caret-Agent/releases',
  licenseUrl: 'https://github.com/plawanpawin-byte/Caret-Agent',
  updateUrl: '', // updates arrive as new installers for now
  configurationDefaults: {
    ...(p.configurationDefaults || {}),
    'workbench.colorTheme': 'Caret Dark',
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

step('icon and version');
if (fs.existsSync(RCEDIT) && fs.existsSync(ICON)) {
  const r = spawnSync(RCEDIT, [path.join(OUT, EXE), '--set-icon', ICON,
    '--set-version-string', 'FileDescription', 'Caret IDE', '--set-version-string', 'ProductName', 'Caret IDE',
    '--set-version-string', 'InternalName', 'Caret IDE', '--set-version-string', 'OriginalFilename', EXE,
    '--set-version-string', 'CompanyName', 'Caret', '--set-file-version', VERSION, '--set-product-version', VERSION], { encoding: 'utf8' });
  if (r.status !== 0) console.log('icon step failed:', r.stderr || r.error);
} else console.log('no rcedit or icon: skipped');
console.log('done:', OUT);
