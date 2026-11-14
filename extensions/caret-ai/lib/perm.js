'use strict';
// Auto permission: decide whether a shell command may run by itself or the user must say yes first.
// Only plain, well-known commands run on their own. Anything else (deleting, network, git push, installs of new
// packages, unknown programs, redirects, subshells) asks first. This is a safety net, not a sandbox.

const VETO = /(`|\$\(|<\(|\bsudo\b|\brm\b|\bdel\b|\berase\b|\brmdir\b|\brd\b|\bformat\b|\bshutdown\b|\breg\b|\bchmod\b|\bchown\b|\bcurl\b|\bwget\b|\bnc\b|\bncat\b|\bssh\b|\bscp\b|\bftp\b|\bbitsadmin\b|\bcertutil\b|\btaskkill\b|\bkill\b|\bmklink\b|\bpowershell\b|\bpwsh\b|\bcmd\b|\binvoke-[a-z]+|\biwr\b|\birm\b|\biex\b|\bremove-item\b|\bset-executionpolicy\b|\bstart-process\b|\bmove\b|\bmv\b|-exec\b|-delete\b|\.env\b)/i;

const SAFE = [
  /^(cd|ls|dir|pwd|echo|cat|type|head|tail|wc|sort|uniq|tree|where|which|date|whoami|hostname|more)(\s|$)/i,
  /^(grep|rg|findstr)(\s|$)/i,
  /^find\s/i,
  /^git\s+(status|log|diff|show|branch|rev-parse|ls-files|blame|remote\s+-v|add|commit|stash)(\s|$)/i,
  /^(node|python|python3|py|deno|bun)\s+(--version|-v|-V)$/i,
  /^(node|python|python3|py|bun)\s+(?!-)[^\s]+(\s|$)/i,
  /^(npm|pnpm|yarn)\s+(test|t|ci|ls|list|outdated|audit|run\s+[\w:.-]+|start|build|lint|dev)(\s|$)/i,
  /^(npm|pnpm|yarn)\s+(install|i|add)\s*$/i,
  /^npx\s+(--no-install\s+)?(tsc|eslint|prettier|jest|vitest|mocha|playwright|vite|next|astro|tsx)(\s|$)/i,
  /^(tsc|eslint|prettier|jest|vitest|pytest|mocha)(\s|$)/i,
  /^python3?\s+-m\s+(pytest|unittest|venv|pip\s+list)(\s|$)/i,
  /^pip3?\s+(list|show|freeze)(\s|$)/i,
  /^(go)\s+(test|build|vet|fmt|run|mod\s+tidy)(\s|$)/i,
  /^cargo\s+(build|test|check|run|clippy|fmt)(\s|$)/i,
  /^dotnet\s+(build|test|run)(\s|$)/i,
  /^(mvn|gradle|gradlew)\s+(test|build|compile|clean\s+test)(\s|$)/i,
  /^make(\s+(test|build|all|check))?$/i,
  /^(wrangler)\s+(dev|whoami)(\s|$)/i,
];

// A redirect writes a file; only the harmless ones (2>&1, to nul or /dev/null) are fine.
function hasRedirect(cmd) {
  const s = cmd.replace(/2>&1/g, '').replace(/>\s*(nul|\/dev\/null)\b/gi, '');
  return /[<>]/.test(s);
}

// true: runs by itself. false: ask the user first.
function isSafe(command) {
  const cmd = String(command || '').trim();
  if (!cmd || cmd.length > 600 || cmd.includes('\n')) return false;
  if (VETO.test(cmd) || hasRedirect(cmd)) return false;
  const parts = cmd.split(/&&|\|\||;|\|/).map(x => x.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(p => SAFE.some(re => re.test(p)));
}

// Auto permission runs commands by itself. Only these (wiping folders, system changes, piping a download into a shell,
// rewriting git history) still ask the user first.
const DANGER = [
  /\brm\s+(-[a-z]*[rf][a-z]*|--recursive|--force)\b/i,
  /\b(del|erase)\b[^&|;]*\s\/[sq]\b/i,
  /\b(rmdir|rd)\b[^&|;]*\s\/s\b/i,
  /\bremove-item\b[^&|;]*-(recurse|force)/i,
  /\bsudo\b/i,
  /\b(mkfs|diskpart|shutdown|reboot|halt)\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdd\s+if=/i,
  /\breg\s+(add|delete)\b/i,
  /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|;&]*\|\s*(sh|bash|zsh|iex|invoke-expression|powershell|pwsh)\b/i,
  /\bset-executionpolicy\b/i,
  /\bgit\s+push\b[^&|;]*(--force|\s-f\b)/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i,
  /\bchmod\s+-R\b|\bchown\s+-R\b/i,
  />\s*\/dev\/(sd|nvme|disk)/i,
];
const isDangerous = command => { const c = String(command || ''); return DANGER.some(re => re.test(c)); };

module.exports = { isSafe, isDangerous };
